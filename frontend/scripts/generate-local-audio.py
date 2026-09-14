import json, subprocess, hashlib, math, wave, array
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path(__file__).resolve().parents[2]; out=root/'frontend/public/audio'; tmp=root/'.local-preview/audio-work'
out.mkdir(parents=True, exist_ok=True); tmp.mkdir(parents=True, exist_ok=True)
story=json.loads((root/'stories/lost-sunshine.json').read_text())
texts=[story['opening'], *story['full_text'], *story['before_answers'].values(), *story['after_answers'].values(), '谢谢老板，我会把这件事告诉苏晚。那我先告辞了。']
texts=list(dict.fromkeys(texts)); manifest={}
def voice(text):
    name='voice-'+hashlib.sha256(text.encode()).hexdigest()[:12]
    source=tmp/(name+'.aiff'); target=out/(name+'.wav')
    if not target.exists():
        subprocess.run(['say','-v','Tingting','-r','195','-o',str(source),text],check=True)
        subprocess.run(['afconvert','-f','WAVE','-d','LEI16@22050',str(source),str(target)],check=True)
    return text,'/audio/'+target.name
with ThreadPoolExecutor(max_workers=3) as pool:
    for text,path in pool.map(voice,texts): manifest[text]=path
(out/'voices.json').write_text(json.dumps(manifest,ensure_ascii=False))
# Original, gently repeating pentatonic music-box motif with soft harmonic keys.
sr=22050; duration=64; total=duration*sr; buf=[0.0]*total
chords=[(48,55,60,64),(45,52,57,60),(41,48,53,57),(43,50,55,59)]
melody=[76,79,81,79,76,74,72,74,76,79,84,81,79,76,74,72]
def note(midi,start,length,amp):
    freq=440*2**((midi-69)/12); offset=int(start*sr)
    for j in range(min(int(length*sr),total-offset)):
        t=j/sr; env=(1-math.exp(-t*45))*math.exp(-t*1.1)*(min(1,(length-t)*3))
        value=amp*env*(math.sin(2*math.pi*freq*t)+.25*math.exp(-t*2)*math.sin(2*math.pi*freq*2*t)+.07*math.sin(2*math.pi*freq*3*t))
        buf[offset+j]+=value
for bar in range(8):
    chord=chords[bar%4]
    for beat in range(8): note(chord[beat%4],bar*8+beat,3.8,.11)
    for beat in range(4): note(melody[(bar*2+beat)%len(melody)],bar*8+beat*2+.15,4,.10)
# Quiet echoes, with cyclic tail so the loop seam stays gentle.
for delay,amount in [(int(.29*sr),.17),(int(.51*sr),.09)]:
    base=buf[:]
    for i in range(total): buf[i]+=base[(i-delay)%total]*amount
peak=max(abs(x) for x in buf)
with wave.open(str(out/'afternoon.wav'),'wb') as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(sr)
    f.writeframes(array.array('h',(int(x/max(peak,1)*21000) for x in buf)).tobytes())
print('Generated',len(manifest),'Chinese voice lines and original 64-second looping background music.')
