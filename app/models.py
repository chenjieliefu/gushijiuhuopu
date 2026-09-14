from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class ConfirmCommand(Command):
    confirm: Literal[True]


class ScreeningProgressCommand(Command):
    # Omitted by legacy/automatic clients, preserving their timing and fingerprints.
    advance_mode: Literal["manual"] | None = None
    run_id: UUID
    segment_id: str = Field(min_length=1, max_length=80)


class ScreeningResumeCommand(Command):
    run_id: UUID


class CollectCommand(Command):
    # Legacy demo callers may omit it; the screening flow requires explicit True.
    confirm: Literal[True] | None = None


class ContentSource(Model):
    reference: str = ""
    author: str | None = None
    original_url: str | None = None
    text_format: Literal["paragraphs", "screening_units"] = "screening_units"
    original_verified: bool = False
    note: str = ""


class AssetReference(Model):
    id: str
    path: str
    status: Literal["pending", "approved"] = "pending"


class ScreeningSegment(Model):
    id: str
    text: str = Field(min_length=1)
    duration_ms: int = Field(gt=0, le=120000)
    visual: str
    asset_id: str | None = None


class ScreeningConfig(Model):
    segments: list[ScreeningSegment] = Field(min_length=1)
    discloses_facts: list[str]
    start_line: str
    after_line: str


class Playback(Model):
    run_id: UUID
    next_segment: int = Field(default=0, ge=0)
    segment_started_at: float
    completed: bool = False


class ScreeningView(Model):
    story_id: str
    story_version: str
    version: int = Field(ge=0)
    phase: str
    playback: Playback
    segment: ScreeningSegment | None
    total_segments: int = Field(gt=0)


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
    story_version: str = ""
    title: str = ""
    owner: str = ""
    custodian: str = ""
    recipient: str = ""
    adaptation_note: str = ""
    full_text: list[str] = Field(default_factory=list)
    source: ContentSource = Field(default_factory=ContentSource)
    assets: list[AssetReference] = Field(default_factory=list)


class State(Model):
    session_id: str
    story_id: str
    story_version: str
    is_test_fixture: bool
    version: int = 0
    status: Literal["active", "completed"] = "active"
    phase: Literal["exploration", "before_screening", "screening", "after_screening", "completed"] = "exploration"
    playback: Playback | None = None
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

    @model_validator(mode="before")
    @classmethod
    def legacy_completed_phase(cls, values):
        if isinstance(values, dict) and "phase" not in values and values.get("status") == "completed":
            return {**values, "phase": "completed"}
        return values


class SessionCreated(Model):
    token: str
    state: State


class CandidateEvent(Model):
    type: Literal["disclose_fact"]
    fact_id: str


class AIOutput(Model):
    reply: str = Field(min_length=1, max_length=2000)
    expression: Literal["neutral", "thoughtful", "warm"] = "neutral"
    suggested_questions: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(default_factory=list, max_length=3)
    events: list[CandidateEvent] = Field(default_factory=list, max_length=10)


class Fact(Model):
    text: str
    available_after_screening: bool = False
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
    flow: Literal["exploration", "screening"] = "exploration"
    screening: ScreeningConfig | None = None
    owner: str = ""
    custodian: str = ""
    recipient: str = ""
    adaptation_note: str = ""
    identity: str = ""
    knowledge_boundaries: list[str] = Field(default_factory=list)
    source: ContentSource = Field(default_factory=ContentSource)
    full_text: list[str] = Field(default_factory=list)
    assets: list[AssetReference] = Field(default_factory=list)
    before_answers: dict[str, str] = Field(default_factory=dict)
    after_answers: dict[str, str] = Field(default_factory=dict)

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

        if self.flow == "screening":
            if not self.screening:
                raise ValueError("放映章节必须包含字幕时间轴")
            ids = [segment.id for segment in self.screening.segments]
            if len(ids) != len(set(ids)):
                raise ValueError("字幕 ID 不得重复")
            revealed = set(self.screening.discloses_facts)
            if not revealed <= self.facts.keys() or not set(self.core_facts) <= revealed:
                raise ValueError("完整放映必须披露所有核心事实")
            if self.full_text != [segment.text for segment in self.screening.segments]:
                raise ValueError("当前放映单元正文必须与收藏全文一致")
        elif self.screening is not None:
            raise ValueError("探索章节不能配置放映")
        assets = {asset.id for asset in self.assets}
        if len(assets) != len(self.assets):
            raise ValueError("素材 ID 不得重复")
        if self.screening and any(s.asset_id is not None and s.asset_id not in assets for s in self.screening.segments):
            raise ValueError("字幕引用了不存在的素材")
