"""Generate this chapter's warm Mandarin voice pack. Requires edge-tts==7.2.8.
Only the story text is sent to the Microsoft Edge speech service; no credentials.
Assets are generated in a new directory. The existing manifest changes only after all succeed.
"""
import asyncio, hashlib, json, re
from pathlib import Path
import edge_tts
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'frontend/public/audio'
PACK = OUT / 'sunny-voice'
STORY = json.loads((ROOT / 'stories/lost-sunshine.json').read_text())
texts = [STORY['opening'], *STORY['full_text'], *STORY['before_answers'].values(), *STORY['after_answers'].values(), STORY['screening']['start_line'], STORY['screening']['after_line'], '谢谢老板，我会把这件事告诉苏晚。那我先告辞了。']
# Match the dialogue page boundaries used by FormalExperience.
texts += [part for text in list(texts) for part in re.findall(r'.{1,115}(?:[，。！？、；：”]|$)|.{1,115}', text)]
texts = list(dict.fromkeys(texts))
async def main():
    PACK.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(3)
    async def render(text):
        name = hashlib.sha256(text.encode()).hexdigest()[:16] + '.mp3'
        target = PACK / name
        async with semaphore:
            if not target.exists() or target.stat().st_size < 1000:
                for attempt in range(3):
                    try:
                        temp = target.with_suffix('.partial.mp3')
                        await edge_tts.Communicate(text, voice='zh-CN-XiaoxiaoNeural', rate='-5%', pitch='+2Hz').save(str(temp))
                        if temp.stat().st_size < 1000: raise RuntimeError('Empty voice output')
                        temp.replace(target)
                        break
                    except Exception:
                        if attempt == 2: raise
                        await asyncio.sleep(1 + attempt)
            print(f'voice {name}', flush=True)
        return text, '/audio/sunny-voice/' + name
    entries = await asyncio.gather(*(render(text) for text in texts))
    manifest = dict(entries)
    pending = OUT / 'voices.pending.json'
    pending.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    pending.replace(OUT / 'voices.json')
    (PACK / 'generation.json').write_text(json.dumps({'voice': 'zh-CN-XiaoxiaoNeural', 'provider':'Microsoft Edge online TTS via edge-tts 7.2.8', 'rate':'-5%', 'pitch':'+2Hz', 'lines':len(manifest)}, ensure_ascii=False, indent=2))
    print(f'COMPLETE {len(manifest)} lines', flush=True)
asyncio.run(main())
