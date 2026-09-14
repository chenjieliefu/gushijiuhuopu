import sys,json,hashlib,subprocess,time
from pathlib import Path
import numpy as np
import mlx.core as mx
import soundfile as sf
import imageio_ffmpeg
from mlx_audio.tts.utils import load_model
ROOT=Path(__file__).resolve().parents[2]; REF=ROOT/'.local-preview/voice-references'; OUT=ROOT/'frontend/public/audio/kanshan-sunny-v2';OUT.mkdir(exist_ok=True)
ff=imageio_ffmpeg.get_ffmpeg_exe()
ref=REF/'kanshan-sunny-reference.wav'
subprocess.run([ff,'-y','-ss','22.2','-t','2.85','-i',str(REF/'kanshan-original.wav'),'-af','highpass=f=110,lowpass=f=8500,afftdn=nf=-28:nr=16:tn=1,loudnorm=I=-21:TP=-3:LRA=8','-ar','24000','-ac','1',str(ref)],capture_output=True,check=True)
pack=json.loads((ROOT/'frontend/public/audio/voices.json').read_text());texts=list(pack['voices']['kanshan']);texts += ['你问的好像和我们的物件无关哦，请换一个问题～','这件事目前还没有交代，我也不能随意猜测。我们可以再聊聊眼前这件旧物。']
model=load_model('mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit');out={};records=[]
work=ROOT/'.local-preview/kanshan-sunny-work';work.mkdir(exist_ok=True)
for i,text in enumerate(texts):
 name=hashlib.sha256(text.encode()).hexdigest()[:16];target=OUT/(name+'.mp3');wav=work/(name+'.wav');start=time.time()
 if not target.exists():
  mx.random.seed(993 if i==2 else 890+i)
  result=list(model.generate(text='是寄展。东西仍然属于苏晚。' if i==2 else text.replace('寄展','“寄展”'),lang_code='Chinese',ref_audio=str(ref),ref_text='哟，给你小红花！',temperature=.4 if i==2 else .5,top_p=.85,max_tokens=max(350,min(1600,len(text)*15)),verbose=False))
  audio=np.concatenate([np.asarray(r.audio,dtype=np.float32).reshape(-1) for r in result]);sr=result[0].sample_rate
  assert np.isfinite(audio).all() and .5<len(audio)/sr<max(30,len(text)*1.3)
  sf.write(wav,audio,sr)
  # Gentle noise reduction and articulation EQ; preserve the character's original pitch.
  subprocess.run([ff,'-y','-i',str(wav),'-af','highpass=f=95,lowpass=f=9000,afftdn=nf=-35:nr=12:tn=1,equalizer=f=280:t=q:w=1:g=-1.5,equalizer=f=2600:t=q:w=0.8:g=1.2,atempo=1.02,loudnorm=I=-19:TP=-2:LRA=8','-ar','24000','-ac','1','-c:a','libmp3lame','-b:a','128k',str(target)],capture_output=True,check=True)
  mx.clear_cache()
 out[text]='/audio/kanshan-sunny-v2/'+target.name
 records.append({'text':text,'path':out[text],'duration':sf.info(target).duration})
 print(json.dumps({'line':i+1,'total':len(texts),'seconds':round(time.time()-start,1)},ensure_ascii=False),flush=True)
 (OUT/'progress.json').write_text(json.dumps(records,ensure_ascii=False,indent=2))
pack['voices']['kanshan']=out
(OUT/'manifest.pending.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2));print('COMPLETE',flush=True)
