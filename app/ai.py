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
