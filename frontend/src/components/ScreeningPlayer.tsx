import { useEffect, useRef, useState } from "react";
import { frameArt, loadArtwork } from "../data/screening-art";
import { GameError, type ScreeningView } from "../services/contract";
import type { useGame } from "../useGame";

type Game = ReturnType<typeof useGame>;
export function ScreeningPlayer({
  game,
  onRecovery,
}: {
  game: Game;
  onRecovery: () => void;
}) {
  const latest = useRef(game);
  latest.current = game;
  const [view, setView] = useState<ScreeningView | null>(null);
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const state = game.state!;
  const recovery =
    game.needsResume || !!game.failed || !!game.error || !!readError;
  const sending = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    if (
      state.phase !== "screening" ||
      game.needsResume ||
      game.failed ||
      game.error
    )
      return;
    const expected = state;
    void (async () => {
      try {
        const next = await latest.current.getScreening();
        if (!active) return;
        if (
          next.story_id !== expected.story_id ||
          next.story_version !== expected.story_version ||
          next.version !== expected.version ||
          next.playback?.run_id !== expected.playback?.run_id ||
          next.playback?.next_segment !== expected.playback?.next_segment ||
          next.phase !== "screening" ||
          !next.segment
        ) {
          throw new GameError(
            "VERSION_CONFLICT",
            "播放进度已有变化，请同步后继续。",
          );
        }
        const art = frameArt(
          next.story_id,
          next.story_version,
          next.segment.id,
        );
        if (art.src) await loadArtwork(art.src);
        if (active) {
          setReadError("");
          setView(next);
        }
      } catch (error) {
        if (active) {
          setReadError(error instanceof Error ? error.message : "字幕未能加载");
          latest.current.requireResume();
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [
    state.version,
    state.phase,
    state.playback?.run_id,
    game.needsResume,
    game.failed,
    game.error,
    reload,
  ]);
  useEffect(() => {
    const interrupted = () => {
      if (document.hidden) {
        latest.current.requireResume();
      }
    };
    document.addEventListener("visibilitychange", interrupted);
    window.addEventListener("pagehide", interrupted);
    return () => {
      document.removeEventListener("visibilitychange", interrupted);
      window.removeEventListener("pagehide", interrupted);
    };
  }, []);
  useEffect(() => {
    if (
      recovery ||
      !view?.segment ||
      !view.playback ||
      view.version !== state.version ||
      document.hidden
    )
      return;
    const segment = view.segment;
    const run = view.playback.run_id;
    const key = `${run}:${segment.id}:${view.version}`;
    if (sending.current === key) return;
    let raf = 0,
      last: number | null = null,
      elapsed = 0,
      cancelled = false;
    const tick = (now: number) => {
      if (cancelled || document.hidden) return;
      if (last !== null) elapsed += Math.min(now - last, 250);
      last = now;
      if (elapsed >= segment.duration_ms) {
        sending.current = key;
        void latest.current
          .run({
            type: "screening_progress",
            run_id: run,
            segment_id: segment.id,
          })
          .then((ok) => {
            if (!ok) latest.current.requireResume();
          });
      } else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [view, state.version, recovery]);
  const art = view?.segment
    ? frameArt(view.story_id, view.story_version, view.segment.id)
    : { src: null, kind: "paper" as const };
  return (
    <main
      className={`screening-room ${recovery ? "is-interrupted" : ""}`}
      aria-label="故事放映"
    >
      <div className="film-topline">
        <span>故事旧货铺 / 私人放映室</span>
        <span>苏晚的故事</span>
      </div>
      <div
        className={`film-frame film-${art.kind}`}
        key={`${view?.playback?.run_id}:${view?.segment?.id}`}
      >
        {art.src && <img src={art.src} alt="" className="film-art" />}
        <div className="film-shade" />
        {!view && !recovery && (
          <p className="film-loading" role="status">
            灯光暗下来了，故事即将开始…
          </p>
        )}
        {view?.segment && (
          <div
            className="film-caption"
            data-testid="film-caption"
            data-segment={view.segment.id}
          >
            <span>苏晚的故事</span>
            <p>{view.segment.text}</p>
          </div>
        )}
      </div>
      <div className="film-bottomline">
        <span>遗失的晴天</span>
        <span>一段时光，慢慢放映</span>
      </div>
      {recovery && (
        <div className="screening-recovery" role="region" aria-label="恢复放映">
          <p className="eyebrow">故事还在这里</p>
          <h1>从停下的地方，继续。</h1>
          <p>
            {readError || "未完成的这一幕会从头播放，已经看过的进度仍然保留。"}
          </p>
          {game.failed ? (
            <p>请先确认上次操作的结果，再继续放映。</p>
          ) : (
            <button
              className="primary"
              disabled={game.busy || !!game.error}
              onClick={() => {
                setReadError("");
                sending.current = null;
                setReload((x) => x + 1);
                const run = latest.current.state?.playback?.run_id;
                if (run)
                  void latest.current.run({
                    type: "screening_resume",
                    run_id: run,
                  });
              }}
            >
              继续放映
            </button>
          )}
          <button onClick={onRecovery}>查看恢复选项</button>
        </div>
      )}
    </main>
  );
}
