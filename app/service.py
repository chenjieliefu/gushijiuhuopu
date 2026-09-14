import asyncio
import logging

from app.ai import AIProvider
from app.errors import AppError
from app.models import AIOutput, Clue, Collection, Command, Message, State, Story
from app.store import Store, fresh_state

logger = logging.getLogger(__name__)


class Game:
    def __init__(self, store: Store, story: Story, ai: AIProvider, timeout: float):
        self.store, self.story, self.ai, self.timeout = store, story, ai, timeout

    def refresh_rules(self, state: State):
        facts = set(state.disclosed_facts)
        state.unlocked_pages = [k for k, page in self.story.pages.items() if set(page.requires_facts) <= facts]
        state.can_collect = state.status == "active" and set(self.story.core_facts) <= facts

    async def execute(self, token: str, operation: str, command: Command, page_id: str | None = None) -> State:
        state = self.store.get(token)
        payload = command.model_dump(mode="json") | {"page_id": page_id}
        fingerprint = self.store.fingerprint(operation, payload)
        request_id = str(command.request_id)
        previous = self.store.replay(state.session_id, request_id, fingerprint)
        if previous is not None:
            return previous
        if command.expected_version != state.version:
            raise AppError(409, "VERSION_CONFLICT", "进度已更新，请重新读取后再操作")
        if operation == "reset":
            state = fresh_state(state.session_id, self.story, state.version)
        else:
            if (state.story_id, state.story_version) != (self.story.id, self.story.version):
                raise AppError(409, "STORY_VERSION_CHANGED", "故事配置已更换，请确认重置后开始新体验")
            if state.status == "completed" and operation not in {"read_page", "collect"}:
                raise AppError(409, "SESSION_COMPLETED", "本次来访已结束，可回顾收藏或重新开始")
            if operation == "inspect":
                target = self.story.targets.get(command.target_id)
                if target is None:
                    raise AppError(404, "TARGET_NOT_FOUND", "检查点不存在")
                if command.target_id not in {clue.id for clue in state.clues}:
                    state.clues.append(Clue(id=command.target_id, text=target.text))
            elif operation == "chat":
                if len(state.messages) >= 201:
                    raise AppError(409, "TURN_LIMIT", "测试会话最多 100 轮问答，请确认重置后继续")
                try:
                    raw = await asyncio.wait_for(self.ai.generate(
                        message=command.message, state=state.model_copy(deep=True), story=self.story.model_copy(deep=True),
                    ), timeout=self.timeout)
                    result = AIOutput.model_validate(raw)
                except TimeoutError:
                    raise AppError(504, "AI_TIMEOUT", "回复超时，进度未改变，请保留输入并重试") from None
                except Exception:
                    # 不记录异常正文，第三方 SDK 的异常可能包含提示词或密钥。
                    logger.warning("ai_provider_failed")
                    raise AppError(502, "AI_UNAVAILABLE", "回复生成失败，进度未改变，可以重试") from None
                for event in result.events:
                    fact = self.story.facts.get(event.fact_id)
                    if fact is None or not set(fact.requires_clues) <= {c.id for c in state.clues} or not set(fact.requires_facts) <= set(state.disclosed_facts):
                        raise AppError(502, "INVALID_AI_EVENT", "AI 返回了不允许的剧情事件，进度未改变")
                    if event.fact_id not in state.disclosed_facts:
                        state.disclosed_facts.append(event.fact_id)
                state.messages.extend([Message(role="user", text=command.message), Message(role="assistant", text=result.reply)])
                state.expression = result.expression
                state.suggested_questions = result.suggested_questions
                # 摘要采用已校验事实，不让模型摘要把玩家猜测写成事实。
                state.summary = "\n".join(self.story.facts[k].text for k in state.disclosed_facts)
            elif operation == "read_page":
                if page_id not in state.unlocked_pages:
                    raise AppError(403, "PAGE_LOCKED", "故事片段尚未解锁")
                if page_id not in state.read_pages:
                    state.read_pages.append(page_id)
            elif operation == "collect":
                self.refresh_rules(state)
                if state.collection is None:
                    if not state.can_collect:
                        raise AppError(409, "COLLECTION_LOCKED", "核心事实尚未披露，暂不能接收寄展")
                    state.collection = Collection(story_id=self.story.id, item_name=self.story.item_name, summary=self.story.collection_summary)
                    state.status = "completed"
            self.refresh_rules(state)
        return self.store.commit(state, command.expected_version, request_id, fingerprint)
