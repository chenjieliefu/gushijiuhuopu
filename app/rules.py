"""创建、重置及命令提交共用的派生规则。"""
from app.models import State, Story


def refresh_rules(state: State, story: Story) -> None:
    facts = set(state.disclosed_facts)
    screening_done = state.phase in {'after_screening', 'completed'}
    state.unlocked_pages = [
        key for key, page in story.pages.items()
        if set(page.requires_facts) <= facts
        and (story.flow != 'screening' or screening_done)
    ]
    state.can_collect = (
        state.status == 'active' and set(story.core_facts) <= facts
        and (story.flow != 'screening' or state.phase == 'after_screening')
    )
