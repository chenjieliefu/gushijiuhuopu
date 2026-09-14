"""Only synthesize dialogue already delivered to this authenticated player."""
import os
import re
import httpx
from pydantic import BaseModel, Field
from app.errors import AppError


class VoiceRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200)


async def dialogue_audio(state, text):
    permitted = set()
    for message in state.messages[-12:]:
        if message.role == 'assistant':
            permitted.add(message.text)
            permitted.update(re.findall(r'.{1,115}(?:[，。！？、；：”]|$)|.{1,115}', message.text))
    if text not in permitted:
        raise AppError(403, 'VOICE_NOT_ALLOWED', '只能朗读本次对话中看山已经说过的内容')
    endpoint = os.getenv('VOICE_SERVICE_URL', '')
    if not endpoint:
        raise AppError(503, 'VOICE_UNAVAILABLE', '本句配音暂不可用，可以继续阅读')
    try:
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            result = await client.post(endpoint.rstrip('/') + '/synthesize', json={'text': text})
            result.raise_for_status()
            if not result.headers.get('content-type', '').startswith('audio/mpeg') or len(result.content) > 2_000_000:
                raise ValueError('Invalid audio')
            return result.content
    except (httpx.HTTPError, ValueError):
        raise AppError(503, 'VOICE_UNAVAILABLE', '本句配音暂不可用，可以继续阅读') from None
