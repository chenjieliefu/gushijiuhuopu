import { useState } from "react";
import { Music2, Volume2, VolumeX, X } from "lucide-react";
import { setSound, unlockSound, useAtmosphere } from "../audio/atmosphere";
export function SoundControls() {
  const sound = useAtmosphere();
  const [open, setOpen] = useState(false);
  return (
    <div className="sound-controls">
      <button
        aria-label="声音设置"
        aria-expanded={open}
        onClick={() => {
          void unlockSound();
          setOpen(!open);
        }}
      >
        {sound.music || sound.voice ? (
          <Volume2 size={17} />
        ) : (
          <VolumeX size={17} />
        )}
        <span>声音</span>
      </button>
      {open && (
        <div className="sound-popover" role="group" aria-label="音乐与朗读">
          <div className="sound-title">
            店里的声音
            <button aria-label="关闭声音设置" onClick={() => setOpen(false)}>
              <X size={15} />
            </button>
          </div>
          <label>
            <Music2 size={14} />
            背景音乐
            <input
              aria-label="背景音乐音量"
              type="range"
              min="0"
              max="1"
              step=".05"
              value={sound.music}
              onChange={(e) => setSound("music", Number(e.target.value))}
            />
            <button onClick={() => setSound("music", sound.music ? 0 : 0.26)}>
              {sound.music ? "关闭" : "开启"}
            </button>
          </label>
          <label>
            <Volume2 size={14} />
            中文朗读
            <input
              aria-label="朗读音量"
              type="range"
              min="0"
              max="1"
              step=".05"
              value={sound.voice}
              onChange={(e) => setSound("voice", Number(e.target.value))}
            />
            <button onClick={() => setSound("voice", sound.voice ? 0 : 0.85)}>
              {sound.voice ? "关闭" : "开启"}
            </button>
          </label>
          <small>
            轻柔旋律 · 温暖女声
            <br />
            中文合成配音，朗读时音乐自动降低。
          </small>
          {sound.notice && <p role="status">{sound.notice}</p>}
        </div>
      )}
    </div>
  );
}
