"""Render the chapter with two user-provided reference voices, locally on Apple Silicon.
Requires mlx-audio==0.5.4, soundfile and imageio-ffmpeg in a separate generation environment.
The private reference directory is excluded from release packages. The public manifest
is switched only after both complete voice tracks are generated and validated.
"""
import argparse, hashlib, json, time, subprocess
from pathlib import Path
import numpy as np
import mlx.core as mx
import soundfile as sf
import imageio_ffmpeg
from mlx_audio.tts.utils import load_model

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / '.local-preview/voice-references'
OUT = ROOT / 'frontend/public/audio/reference-voices-v1'
MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit'

def scripts():
    import re
    story = json.loads((ROOT/'stories/lost-sunshine.json').read_text())
    lines = [story['opening'], *story['before_answers'].values(), *story['after_answers'].values(), story['screening']['start_line'], story['screening']['after_line'], '谢谢老板，我会把这件事告诉苏晚。那我先告辞了。']
    # Keep these boundaries identical to FormalExperience's dialogue pagination.
    lines += [p for t in list(lines) for p in re.findall(r'.{1,115}(?:[，。！？、；：”]|$)|.{1,115}',t)]
    return {'narrator':list(dict.fromkeys(story['full_text'])), 'kanshan':list(dict.fromkeys(lines))}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--samples',action='store_true');ap.add_argument('--publish',action='store_true');args=ap.parse_args()
    refs=json.loads((REF/'references.json').read_text())
    model=load_model(MODEL)
    manifests={};report=[]
    for role,lines in scripts().items():
        if args.samples:lines=lines[:1]
        manifests[role]={}; dest=OUT/role;dest.mkdir(parents=True,exist_ok=True)
        for i,text in enumerate(lines):
            name=hashlib.sha256(text.encode()).hexdigest()[:16];target=dest/(name+'.mp3');work=ROOT/'.local-preview/reference-voice-work'/role;work.mkdir(parents=True,exist_ok=True);wav=work/(name+'.wav')
            start=time.time()
            if not target.exists():
                clear_term = role == "kanshan" and i in (1, 2)
                mx.random.seed(990+i+1 if clear_term else 620+i)
                spoken_text = text.replace("寄展", "“寄展”") if clear_term else text
                results=list(model.generate(text=spoken_text,lang_code='Chinese',ref_audio=str(REF/f'{role}-reference.wav'),ref_text=refs[role]['text'],temperature=.45 if clear_term else .65,top_p=.9,max_tokens=max(350,min(1600,len(text)*15)),verbose=False))
                samples=np.concatenate([np.asarray(r.audio,dtype=np.float32).reshape(-1) for r in results]);sr=results[0].sample_rate
                if not np.isfinite(samples).all() or np.max(np.abs(samples))<.005:raise ValueError('Invalid generated audio')
                duration=len(samples)/sr
                if not .5<duration<max(30,len(text)*1.3):raise ValueError(f'Unexpected duration {duration}')
                sf.write(wav,samples,sr,subtype='PCM_16')
                subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-i',str(wav),'-af',('atempo=0.94,' if clear_term else '')+'loudnorm=I=-19:TP=-2:LRA=9','-codec:a','libmp3lame','-b:a','128k',str(target.with_suffix('.partial.mp3'))],capture_output=True,check=True)
                target.with_suffix('.partial.mp3').replace(target)
                mx.clear_cache()
            info=sf.info(wav)
            record={'role':role,'index':i+1,'text':text,'path':'/audio/reference-voices-v1/'+role+'/'+target.name,'duration':info.duration,'elapsed':round(time.time()-start,1)}
            report.append(record);manifests[role][text]=record['path']
            print(json.dumps({k:record[k] for k in ['role','index','duration','elapsed']},ensure_ascii=False),flush=True)
            (OUT/'progress.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    result={'version':2,'voices':manifests}
    (OUT/('sample-manifest.json' if args.samples else 'manifest.pending.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2))
    if args.publish and not args.samples:
        pending=ROOT/'frontend/public/audio/voices.pending.json';pending.write_text(json.dumps(result,ensure_ascii=False,indent=2));pending.replace(ROOT/'frontend/public/audio/voices.json')
    print('COMPLETE samples' if args.samples else 'COMPLETE full pack (awaiting transcription validation unless --publish)',flush=True)
if __name__=='__main__': main()
