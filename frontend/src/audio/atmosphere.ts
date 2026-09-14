import { useEffect, useSyncExternalStore } from "react";

export type VoiceRole = "narrator" | "kanshan";
export type VoiceFetcher = (text: string, signal: AbortSignal) => Promise<Blob>;
type RoleVoicePack = {
  version: 2;
  voices: Record<VoiceRole, Record<string, string>>;
};
type VoiceManifest = Record<string, string> | RoleVoicePack;

type Settings = {
  music: number;
  voice: number;
  active: boolean;
  speaking: boolean;
  notice: string;
};
let saved: Partial<Settings> = {};
try {
  saved = JSON.parse(localStorage.getItem("story-shop:sound:v1") || "{}");
} catch {
  /* Defaults work without storage. */
}
let state: Settings = {
  music: saved.music ?? 0.26,
  voice: saved.voice ?? 0.85,
  active: false,
  speaking: false,
  notice: "",
};
const listeners = new Set<() => void>();
let music: HTMLAudioElement | undefined;
let voice: HTMLAudioElement | undefined;
let finishVoice: (() => void) | undefined;
let generation = 0;
let manifest: Promise<VoiceManifest> | undefined;
let voiceRequest: AbortController | undefined;
let objectUrl: string | undefined;
function update(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
function volume() {
  if (music) music.volume = state.music * (state.speaking ? 0.32 : 1);
}
export function setSound(kind: "music" | "voice", value: number) {
  update({ [kind]: Math.max(0, Math.min(1, value)) });
  try {
    localStorage.setItem(
      "story-shop:sound:v1",
      JSON.stringify({ music: state.music, voice: state.voice }),
    );
  } catch {
    /* Optional preference. */
  }
  volume();
  if (voice) voice.volume = state.voice;
  if (kind === "voice" && !value) stopVoice();
  if (kind === "music") {
    if (!value) music?.pause();
    else void unlockSound();
  }
}
export async function unlockSound() {
  if (!music) {
    music = new Audio("/audio/afternoon.wav");
    music.loop = true;
    music.preload = "auto";
  }
  update({ active: true });
  volume();
  if (state.music > 0 && music.paused && !document.hidden) {
    try {
      await music.play();
    } catch {
      update({ notice: "点击声音按钮开启音乐" });
    }
  }
}
export function stopVoice() {
  generation++;
  voiceRequest?.abort();
  voiceRequest = undefined;
  if (voice) {
    voice.pause();
    voice.removeAttribute("src");
    voice.load();
    voice = undefined;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  finishVoice?.();
  finishVoice = undefined;
  update({ speaking: false });
  volume();
}
export async function speak(
  text: string,
  role: VoiceRole = "kanshan",
  fetchVoice?: VoiceFetcher,
): Promise<void> {
  stopVoice();
  if (!state.active || !state.voice || !text || document.hidden) return;
  const request = generation;
  manifest ||= fetch("/audio/voices.json", { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw Error("voice");
    return r.json();
  });
  let path: string | undefined;
  try {
    const pack = await manifest;
    path =
      pack.version === 2
        ? (pack as RoleVoicePack).voices[role]?.[text]
        : (pack as Record<string, string>)[text];
  } catch {
    manifest = undefined;
  }
  if (request !== generation || !state.voice || document.hidden) return;
  if (!path && role === "kanshan" && fetchVoice) {
    const controller = new AbortController();
    voiceRequest = controller;
    update({ notice: "看山正在准备朗读…" });
    try {
      const blob = await fetchVoice(text, controller.signal);
      if (request !== generation || !state.voice || document.hidden) return;
      path = objectUrl = URL.createObjectURL(blob);
    } catch {
      // Reading stays interactive even when voice generation is unavailable.
    }
  }
  if (request !== generation || !state.voice || document.hidden) return;
  update({ speaking: true, notice: "" });
  volume();
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (request === generation) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = undefined;
        update({ speaking: false });
        volume();
      }
      resolve();
    };
    const timer = window.setTimeout(
      () => {
        if (voice) voice.pause();
        finish();
      },
      Math.max(45000, text.length * 700),
    );
    finishVoice = finish;
    if (path) {
      const audio = new Audio(path);
      voice = audio;
      audio.volume = state.voice;
      audio.onended = finish;
      audio.onerror = () => {
        update({ notice: "本句朗读暂不可用，字幕继续" });
        finish();
      };
      audio.play().catch(() => {
        update({ notice: "朗读未开启，点声音按钮后可重听" });
        finish();
      });
    } else {
      update({ notice: "这句暂未配音，可以继续阅读" });
      finish();
    }
  });
}
export function useAtmosphere() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
export function useVoice(
  text: string,
  enabled = true,
  role: VoiceRole = "kanshan",
  fetchVoice?: VoiceFetcher,
) {
  useEffect(() => {
    if (enabled && text) void speak(text, role, fetchVoice);
    return () => stopVoice();
  }, [text, enabled, role, fetchVoice]);
}
export function useSoundLifecycle() {
  useEffect(() => {
    const gesture = () => {
      void unlockSound();
    };
    const visibility = () => {
      if (document.hidden) {
        music?.pause();
        stopVoice();
      } else if (state.active) void unlockSound();
    };
    window.addEventListener("pointerdown", gesture, {
      once: true,
      capture: true,
    });
    window.addEventListener("keydown", gesture, { once: true, capture: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerdown", gesture, true);
      window.removeEventListener("keydown", gesture, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
}
