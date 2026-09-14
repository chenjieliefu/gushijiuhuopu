import asyncio
import logging
import time
from uuid import uuid4

from app.ai import AIProvider, allowed_context
from app.errors import AppError
from app.models import AIOutput, Clue, Collection, Command, Message, Playback, State, Story
from app.rules import refresh_rules
from app.store import Store, fresh_state

logger = logging.getLogger(__name__)


class Game:
    def __init__(self, store: Store, story: Story, ai: AIProvider, timeout: float,
                 clock=time.time, max_parallel_chats: int = 4):
        self.store, self.story, self.ai, self.timeout = store, story, ai, timeout
        self.clock = clock
        self.max_parallel_chats = max_parallel_chats
        self.inflight: dict[tuple[str, str], tuple[str, asyncio.Task]] = {}

    def refresh_rules(self, state: State):
        refresh_rules(state, self.story)

    def check_story(self, state: State):
        if (state.story_id, state.story_version) != (self.story.id, self.story.version):
            raise AppError(409, 'STORY_VERSION_CHANGED', '故事配置已更换，请确认重置后开始新体验')

    async def execute(self, token: str, operation: str, command: Command, page_id: str | None = None) -> State:
        if operation != 'chat':
            return await self._execute(token, operation, command, page_id)
        state = await asyncio.to_thread(self.store.get, token)
        key = (state.session_id, str(command.request_id))
        fingerprint = self.store.fingerprint(operation, command.model_dump(mode='json', exclude_none=True) | {'page_id': page_id})
        # A committed retry does not consume an AI slot, even if other sessions are busy.
        previous = await asyncio.to_thread(self.store.replay, *key, fingerprint)
        if previous is not None:
            return previous
        existing = self.inflight.get(key)
        if existing:
            if existing[0] != fingerprint:
                raise AppError(409, 'IDEMPOTENCY_CONFLICT', '同一 request_id 不能用于不同请求')
            return (await asyncio.shield(existing[1])).model_copy(deep=True)
        if len(self.inflight) >= self.max_parallel_chats:
            raise AppError(429, 'AI_BUSY', '回复服务繁忙，请保留原请求稍后重试')
        task = asyncio.create_task(self._execute(token, operation, command, page_id))
        self.inflight[key] = (fingerprint, task)
        def finished(done):
            self.inflight.pop(key, None)
            if not done.cancelled():
                done.exception()  # Consume failures if every waiting client disconnected.
        task.add_done_callback(finished)
        # A disconnected waiter must not cancel the shared call of another waiter.
        return (await asyncio.shield(task)).model_copy(deep=True)

    async def close(self):
        tasks = [task for _, task in self.inflight.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        close_provider = getattr(self.ai, 'aclose', None)
        if close_provider is not None:
            await close_provider()

    async def _execute(self, token: str, operation: str, command: Command, page_id: str | None) -> State:
        state = await asyncio.to_thread(self.store.get, token)
        payload = command.model_dump(mode='json', exclude_none=True) | {'page_id': page_id}
        fingerprint = self.store.fingerprint(operation, payload)
        request_id = str(command.request_id)
        previous = await asyncio.to_thread(self.store.replay, state.session_id, request_id, fingerprint)
        if previous is not None:
            return previous
        if command.expected_version != state.version:
            raise AppError(409, 'VERSION_CONFLICT', '进度已更新，请重新读取后再操作')
        if operation == 'replay':
            self.check_story(state)
            if state.phase != 'completed' or state.collection is None:
                raise AppError(409, 'REPLAY_UNAVAILABLE', '请先完成本次故事，再重新体验')
            collection = state.collection.model_copy(deep=True)
            state = fresh_state(state.session_id, self.story, state.version)
            state.collection = collection
        elif operation == 'reset':
            state = fresh_state(state.session_id, self.story, state.version)
        else:
            self.check_story(state)
            if state.status == 'completed' and operation not in {'read_page', 'collect'}:
                raise AppError(409, 'SESSION_COMPLETED', '本次来访已结束，可回顾收藏或重新开始')
            if state.phase == 'screening' and operation not in {'screening_progress', 'screening_resume'}:
                raise AppError(409, 'SCREENING_IN_PROGRESS', '正在完整放映，结束后再交流或接收寄展')
            if operation.startswith('screening_'):
                self.screening_command(state, operation, command)
            elif operation == 'inspect':
                target = self.story.targets.get(command.target_id)
                if target is None:
                    raise AppError(404, 'TARGET_NOT_FOUND', '检查点不存在')
                if command.target_id not in {clue.id for clue in state.clues}:
                    state.clues.append(Clue(id=command.target_id, text=target.text))
            elif operation == 'chat':
                await self.chat(state, command)
            elif operation == 'read_page':
                if page_id not in state.unlocked_pages:
                    raise AppError(403, 'PAGE_LOCKED', '故事片段尚未解锁')
                if page_id not in state.read_pages:
                    state.read_pages.append(page_id)
            elif operation == 'collect':
                self.refresh_rules(state)
                if self.story.flow == 'screening' and command.confirm is not True:
                    raise AppError(422, 'CONFIRMATION_REQUIRED', '请通过寄展确认卡明确确认接收')
                if state.status == 'active' and not state.can_collect:
                    raise AppError(409, 'COLLECTION_LOCKED', '尚未满足本章节接收条件')
                if state.collection is None:
                    if not state.can_collect:
                        raise AppError(409, 'COLLECTION_LOCKED', '尚未满足本章节接收条件')
                    state.collection = Collection(
                        story_id=self.story.id, story_version=self.story.version,
                        item_name=self.story.item_name, summary=self.story.collection_summary,
                        title=self.story.title, owner=self.story.owner, custodian=self.story.custodian,
                        recipient=self.story.recipient, adaptation_note=self.story.adaptation_note,
                        full_text=self.story.full_text, source=self.story.source, assets=self.story.assets,
                    )
                # A replay ends normally while retaining the original collection snapshot.
                state.status = 'completed'
                state.phase = 'completed'
            else:
                raise AppError(404, 'OPERATION_NOT_FOUND', '操作不存在')
            self.refresh_rules(state)
        # Connections are opened inside the worker. Slow disk / lock waits never block the loop.
        return await asyncio.to_thread(self.store.commit, state, command.expected_version, request_id, fingerprint)

    def screening_command(self, state: State, operation: str, command: Command):
        film = self.story.screening
        if self.story.flow != 'screening' or film is None:
            raise AppError(409, 'SCREENING_UNAVAILABLE', '当前章节没有连续放映')
        if operation == 'screening_start':
            if state.phase != 'before_screening':
                raise AppError(409, 'INVALID_PHASE', '当前阶段不能开始放映')
            state.phase = 'screening'
            state.playback = Playback(run_id=uuid4(), segment_started_at=self.clock())
            state.messages.extend([Message(role='user', text='好，我听着。'),
                                   Message(role='assistant', text=film.start_line)])
            state.suggested_questions = []
            return
        playback = state.playback
        if state.phase != 'screening' or playback is None:
            raise AppError(409, 'INVALID_PHASE', '当前不在放映阶段')
        if command.run_id != playback.run_id:
            raise AppError(409, 'SCREENING_RUN_CHANGED', '放映已恢复或重新开始，请读取最新进度')
        if operation == 'screening_resume':
            # Refresh/reload replays the unfinished unit and invalidates acknowledgements from the old player.
            playback.run_id = uuid4()
            playback.segment_started_at = self.clock()
            return
        if operation != 'screening_progress':
            raise AppError(404, 'OPERATION_NOT_FOUND', '操作不存在')
        segment = film.segments[playback.next_segment]
        if command.segment_id != segment.id:
            raise AppError(409, 'SCREENING_OUT_OF_ORDER', '请按顺序完整播放字幕')
        if command.advance_mode != 'manual' and self.clock() < playback.segment_started_at + segment.duration_ms / 1000:
            raise AppError(409, 'SCREENING_TOO_EARLY', '当前字幕尚未达到最短展示时间')
        playback.next_segment += 1
        playback.segment_started_at = self.clock()
        if playback.next_segment == len(film.segments):
            playback.completed = True
            state.phase = 'after_screening'
            state.disclosed_facts = list(dict.fromkeys(state.disclosed_facts + film.discloses_facts))
            state.summary = '\n'.join(self.story.facts[key].text for key in state.disclosed_facts)
            state.messages.append(Message(role='assistant', text=film.after_line))
            state.suggested_questions = list(self.story.after_answers)[:3]

    async def chat(self, state: State, command: Command):
        if sum(message.role == 'user' for message in state.messages) >= 100:
            raise AppError(409, 'TURN_LIMIT', '当前会话已达到问答上限，请确认重置后继续')
        await asyncio.to_thread(self.store.check_command_capacity, state.session_id)
        await asyncio.to_thread(self.store.reserve_ai_call)
        context = allowed_context(state, self.story)
        try:
            raw = await asyncio.wait_for(self.ai.generate(
                message=command.message, state=state.model_copy(deep=True), story=context,
            ), timeout=self.timeout)
            result = AIOutput.model_validate(raw.model_dump() if isinstance(raw, AIOutput) else raw)
        except TimeoutError:
            raise AppError(504, 'AI_TIMEOUT', '回复超时，进度未改变，请保留输入并重试') from None
        except Exception:
            logger.warning('ai_provider_failed')
            raise AppError(502, 'AI_UNAVAILABLE', '回复生成失败，进度未改变，可以重试') from None
        for event in result.events:
            fact = self.story.facts.get(event.fact_id)
            if (fact is None or event.fact_id not in context.facts
                or not set(fact.requires_clues) <= {c.id for c in state.clues}
                or not set(fact.requires_facts) <= set(state.disclosed_facts)
                or (self.story.flow == 'screening' and event.fact_id not in state.disclosed_facts)):
                raise AppError(502, 'INVALID_AI_EVENT', 'AI 返回了不允许的剧情事件，进度未改变')
            if event.fact_id not in state.disclosed_facts:
                state.disclosed_facts.append(event.fact_id)
        state.messages.extend([Message(role='user', text=command.message), Message(role='assistant', text=result.reply)])
        state.expression = result.expression
        state.suggested_questions = result.suggested_questions
        state.summary = '\n'.join(self.story.facts[key].text for key in state.disclosed_facts)
