"""AI 只返回候选事件，不能直接写数据库或控制收藏。"""
from typing import Protocol

from app.models import AIOutput, CandidateEvent, State, Story


class AIProvider(Protocol):
    async def generate(self, *, message: str, state: State, story: Story) -> AIOutput: ...


class MockAI:
    async def generate(self, *, message: str, state: State, story: Story) -> AIOutput:
        # 仅联调：忽略问题语义，按当前允许的配置披露一个事实。
        clues = {clue.id for clue in state.clues}
        for fact_id, fact in story.facts.items():
            if fact_id in state.disclosed_facts:
                continue
            if set(fact.requires_clues) <= clues and set(fact.requires_facts) <= set(state.disclosed_facts):
                return AIOutput(
                    reply=f"[模拟 AI] {fact.text}",
                    expression="warm",
                    suggested_questions=["还有什么可以了解的？"],
                    events=[CandidateEvent(type="disclose_fact", fact_id=fact_id)],
                )
        return AIOutput(
            reply="[模拟 AI] 暂无新的可披露内容。可以检查尚未查看的物件细节，或回顾已发现内容。",
            suggested_questions=["这件物品还有什么细节？"],
        )


def allowed_context(state: State, story: Story) -> Story:
    """Pass only currently allowed material to the provider; never the hidden film.

    This is an input boundary, not proof that a generative reply is semantically safe.
    The adapter must still validate its reply and suggested questions before returning.
    """
    context = story.model_copy(deep=True)
    after = state.phase in {'after_screening', 'completed'}
    clues, disclosed = {clue.id for clue in state.clues}, set(state.disclosed_facts)
    context.facts = {key: fact for key, fact in context.facts.items()
                     if (not fact.available_after_screening or after)
                     and (key in disclosed or (set(fact.requires_clues) <= clues and set(fact.requires_facts) <= disclosed))}
    context.core_facts = [key for key in context.core_facts if key in context.facts]
    context.targets = {key: target for key, target in context.targets.items() if key in clues}
    context.pages = {key: page for key, page in context.pages.items() if key in state.unlocked_pages}
    context.screening = None
    context.assets = []
    if not after:
        context.full_text = []
        context.after_answers = {}
        context.collection_summary = ''
    return context


class ScriptedAI:
    """Offline acceptance fixture for the real chapter; never presented as a real model."""
    async def generate(self, *, message: str, state: State, story: Story) -> AIOutput:
        answers = story.after_answers if state.phase == 'after_screening' else story.before_answers
        reply = answers.get(message)
        if reply is None:
            reply = ('[脚本联调] 可以选择一个已配置的问题继续。自由问答需要接入真实 AI。'
                     if state.phase == 'after_screening'
                     else '[脚本联调] 我受苏晚委托办理寄展。准备好后，请选择“听听故事”开始完整放映。自由问答尚未接入。')
        return AIOutput(reply=reply, suggested_questions=list(answers)[:3])


def load_provider(mode: str) -> AIProvider:
    if mode == 'mock':
        return MockAI()
    if mode == 'scripted':
        return ScriptedAI()
    if mode == 'custom':
        import importlib
        import inspect
        import os
        location = os.getenv('AI_PROVIDER_FACTORY', '')
        module, separator, name = location.partition(':')
        if not separator or not module or not name or not name.isidentifier():
            raise ValueError('AI_PROVIDER_FACTORY 需为可信的本地 module:factory')
        factory = getattr(importlib.import_module(module), name)
        provider = factory()
        if not inspect.iscoroutinefunction(getattr(provider, 'generate', None)):
            raise ValueError('AI provider 必须实现异步 generate')
        return provider
    raise ValueError('AI_MODE 只支持 mock、scripted、custom')
