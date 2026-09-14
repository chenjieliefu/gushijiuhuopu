"""Optional local Apple Silicon voice worker. Never exposed directly to the internet.
Run with the isolated mlx-audio environment, after preparing the reference clip.
"""
import hashlib,json,os,subprocess,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import numpy as np
import mlx.core as mx
import soundfile as sf
import imageio_ffmpeg
from mlx_audio.tts.utils import load_model

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'.local-preview/voice-references/kanshan-sunny-reference.wav'
CACHE=ROOT/'.local-preview/live-voice-cache-v2';CACHE.mkdir(parents=True,exist_ok=True)
MODEL=load_model('mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit')
LOCK=threading.Lock()
FILTER='highpass=f=95,lowpass=f=9000,afftdn=nf=-35:nr=12:tn=1,equalizer=f=280:t=q:w=1:g=-1.5,equalizer=f=2600:t=q:w=0.8:g=1.2,atempo=1.02,loudnorm=I=-19:TP=-2:LRA=8'
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200 if self.path=='/health' else 404);self.end_headers()
 def do_POST(self):
  size=int(self.headers.get('Content-Length','0'))
  if self.path!='/synthesize' or not 0<size<4096:
   self.send_error(400);return
  try:
   text=json.loads(self.rfile.read(size))['text']
   if not isinstance(text,str) or not 0<len(text)<=200:raise ValueError()
  except (ValueError,KeyError):self.send_error(400);return
  if not LOCK.acquire(blocking=False):self.send_error(429);return
  try:
   digest=hashlib.sha256(text.encode()).hexdigest();target=CACHE/(digest+'.mp3')
   if not target.exists():
    mx.random.seed(890)
    result=list(MODEL.generate(text=text.replace('寄展','“寄展”'),lang_code='Chinese',ref_audio=str(REF),ref_text='哟，给你小红花！',temperature=.5,top_p=.85,max_tokens=min(1800,max(350,len(text)*15)),verbose=False))
    samples=np.concatenate([np.asarray(r.audio,dtype=np.float32).reshape(-1) for r in result]);sr=result[0].sample_rate
    if not np.isfinite(samples).all() or not .5<len(samples)/sr<max(30,len(text)*1.3):raise ValueError('Invalid audio')
    wav=CACHE/(digest+'.wav');sf.write(wav,samples,sr)
    try:
     subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-i',str(wav),'-af',FILTER,'-ar','24000','-ac','1','-c:a','libmp3lame','-b:a','128k',str(target)],capture_output=True,check=True)
    finally:wav.unlink(missing_ok=True)
    mx.clear_cache()
    for old in sorted(CACHE.glob('*.mp3'),key=lambda p:p.stat().st_mtime)[:-256]:old.unlink(missing_ok=True)
   audio=target.read_bytes();self.send_response(200);self.send_header('Content-Type','audio/mpeg');self.send_header('Content-Length',str(len(audio)));self.end_headers();self.wfile.write(audio)
  except (BrokenPipeError,ConnectionResetError):pass
  except Exception:
   self.send_error(503)
  finally:LOCK.release()
print('Local reference voice ready on 127.0.0.1:18090',flush=True)
ThreadingHTTPServer(('127.0.0.1',18090),Handler).serve_forever()
