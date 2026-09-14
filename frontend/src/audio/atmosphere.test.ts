import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
class FakeAudio {
  static all: FakeAudio[] = [];
  paused = true;
  volume = 1;
  loop = false;
  preload = "";
  onended?: () => void;
  onerror?: () => void;
  constructor(public src = "") {
    FakeAudio.all.push(this);
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
}
beforeEach(() => {
  vi.resetModules();
  FakeAudio.all = [];
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("window", { setTimeout, speechSynthesis: { cancel: vi.fn() } });
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        第一句: "/audio/one.wav",
        第二句: "/audio/two.wav",
      }),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("sound and narration lifecycle", () => {
  it("reads a new AI reply through the authenticated voice fetcher", async () => {
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:voice-test");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    const fetchVoice = vi.fn(
      async () => new Blob(["audio"], { type: "audio/mpeg" }),
    );
    const playback = sound.speak("新的故事回答", "kanshan", fetchVoice);
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(2));
    expect(fetchVoice).toHaveBeenCalledWith(
      "新的故事回答",
      expect.any(AbortSignal),
    );
    expect(FakeAudio.all[1].src).toBe("blob:voice-test");
    FakeAudio.all[1].onended?.();
    await playback;
    expect(revoke).toHaveBeenCalledWith("blob:voice-test");
    sound.stopVoice();
    create.mockRestore();
    revoke.mockRestore();
  });
  it("cancels a pending generated voice when the player moves on", async () => {
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    let release!: (blob: Blob) => void;
    const fetchVoice = vi.fn(
      (_text: string, _signal: AbortSignal) =>
        new Promise<Blob>((resolve) => {
          release = resolve;
        }),
    );
    const playback = sound.speak("等待中的回答", "kanshan", fetchVoice);
    await vi.waitFor(() => expect(fetchVoice).toHaveBeenCalled());
    sound.stopVoice();
    expect(fetchVoice.mock.calls[0][1].aborted).toBe(true);
    release(new Blob(["audio"]));
    await playback;
    expect(FakeAudio.all).toHaveLength(1);
  });
  it("selects separate recordings for narration and Kanshan even when the text is identical", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: 2,
          voices: {
            narrator: { 第一句: "/audio/narrator/one.mp3" },
            kanshan: { 第一句: "/audio/kanshan/one.mp3" },
          },
        }),
      })),
    );
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    const narration = sound.speak("第一句", "narrator");
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(2));
    expect(FakeAudio.all[1].src).toBe("/audio/narrator/one.mp3");
    FakeAudio.all[1].onended?.();
    await narration;
    const character = sound.speak("第一句", "kanshan");
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(3));
    expect(FakeAudio.all[2].src).toBe("/audio/kanshan/one.mp3");
    FakeAudio.all[2].onended?.();
    await character;
    sound.stopVoice();
  });
  it("does not play the other role or a system voice when a role recording is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: 2,
          voices: {
            narrator: {},
            kanshan: { 第一句: "/audio/kanshan/one.mp3" },
          },
        }),
      })),
    );
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    await sound.speak("第一句", "narrator");
    expect(FakeAudio.all).toHaveLength(1);
    expect(FakeAudio.all[0].volume).toBeCloseTo(0.26);
  });
  it("ducks music only while narration is playing and restores the chosen volume", async () => {
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    const music = FakeAudio.all[0];
    const spoken = sound.speak("第一句");
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(2));
    expect(music.volume).toBeCloseTo(0.26 * 0.32);
    sound.setSound("music", 0.5);
    expect(music.volume).toBeCloseTo(0.5 * 0.32);
    FakeAudio.all[1].onended?.();
    await spoken;
    expect(music.volume).toBe(0.5);
    sound.stopVoice();
  });
  it("starting another line stops the old voice and settles its wait", async () => {
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    const first = sound.speak("第一句");
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(2));
    const oldVoice = FakeAudio.all[1];
    const second = sound.speak("第二句");
    await first;
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(3));
    expect(oldVoice.paused).toBe(true);
    expect(oldVoice.src).toBe("");
    FakeAudio.all[2].onended?.();
    await second;
    sound.stopVoice();
  });
  it("muting narration releases the playback wait without muting the music", async () => {
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    const line = sound.speak("第一句");
    await vi.waitFor(() => expect(FakeAudio.all).toHaveLength(2));
    sound.setSound("voice", 0);
    await line;
    expect(FakeAudio.all[1].paused).toBe(true);
    expect(FakeAudio.all[0].paused).toBe(false);
    await sound.speak("第二句");
    expect(FakeAudio.all).toHaveLength(2);
  });
  it("ignores a delayed manifest after narration is cancelled", async () => {
    let release!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const sound = await import("./atmosphere");
    await sound.unlockSound();
    const line = sound.speak("第一句");
    sound.stopVoice();
    release({ ok: true, json: async () => ({ 第一句: "/audio/one.wav" }) });
    await line;
    expect(FakeAudio.all).toHaveLength(1);
  });
  it("does not start audio before interaction or when the page is hidden", async () => {
    const sound = await import("./atmosphere");
    await sound.speak("第一句");
    expect(FakeAudio.all).toHaveLength(0);
    await sound.unlockSound();
    vi.stubGlobal("document", { hidden: true });
    await sound.speak("第一句");
    expect(FakeAudio.all).toHaveLength(1);
  });
});
