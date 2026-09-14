from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ErrorDetail(Model):
    code: str
    message: str
    trace_id: str | None


class ErrorEnvelope(Model):
    error: ErrorDetail


class Command(Model):
    request_id: UUID
    expected_version: int = Field(ge=0, strict=True)


class InspectCommand(Command):
    target_id: str = Field(min_length=1, max_length=80)


class ChatCommand(Command):
    message: str = Field(min_length=1, max_length=2000)


class ResetCommand(Command):
    confirm: Literal[True]


class Message(Model):
    role: Literal["user", "assistant"]
    text: str


class Clue(Model):
    id: str
    text: str
    source: Literal["inspection"] = "inspection"


class Page(Model):
    id: str
    title: str
    text: str


class Collection(Model):
    story_id: str
    item_name: str
    summary: str


class State(Model):
    session_id: str
    story_id: str
    story_version: str
    is_test_fixture: bool
    version: int = 0
    status: Literal["active", "completed"] = "active"
    clues: list[Clue] = Field(default_factory=list)
    disclosed_facts: list[str] = Field(default_factory=list)
    unlocked_pages: list[str] = Field(default_factory=list)
    read_pages: list[str] = Field(default_factory=list)
    messages: list[Message] = Field(default_factory=list)
    summary: str = ""
    expression: Literal["neutral", "thoughtful", "warm"] = "neutral"
    suggested_questions: list[str] = Field(default_factory=list)
    can_collect: bool = False
    collection: Collection | None = None


class SessionCreated(Model):
    token: str
    state: State


class CandidateEvent(Model):
    type: Literal["disclose_fact"]
    fact_id: str


class AIOutput(Model):
    reply: str = Field(min_length=1, max_length=2000)
    expression: Literal["neutral", "thoughtful", "warm"] = "neutral"
    suggested_questions: list[str] = Field(default_factory=list, max_length=3)
    events: list[CandidateEvent] = Field(default_factory=list, max_length=10)


class Fact(Model):
    text: str
    requires_clues: list[str] = Field(default_factory=list)
    requires_facts: list[str] = Field(default_factory=list)


class StoryPage(Page):
    requires_facts: list[str]


class Target(Model):
    label: str
    text: str


class Story(Model):
    id: str
    version: str
    is_test_fixture: bool
    title: str
    item_name: str
    opening: str
    targets: dict[str, Target]
    facts: dict[str, Fact]
    core_facts: list[str]
    pages: dict[str, StoryPage]
    collection_summary: str

    def validate_references(self):
        if not self.core_facts or not set(self.core_facts) <= self.facts.keys():
            raise ValueError("故事必须包含有效核心事实")
        for fact in self.facts.values():
            if not set(fact.requires_clues) <= self.targets.keys():
                raise ValueError("事实引用了不存在的检查点")
            if not set(fact.requires_facts) <= self.facts.keys():
                raise ValueError("事实引用了不存在的前置事实")
        for key, page in self.pages.items():
            if key != page.id or not set(page.requires_facts) <= self.facts.keys():
                raise ValueError("故事页引用无效")
        reachable: set[str] = set()
        for _ in self.facts:
            reachable.update(k for k, f in self.facts.items() if set(f.requires_facts) <= reachable)
        if reachable != self.facts.keys():
            raise ValueError("事实依赖有环，无法推进")
