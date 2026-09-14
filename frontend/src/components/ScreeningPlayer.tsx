import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, History, Play, Volume2 } from "lucide-react";
import { speak, stopVoice } from "../audio/atmosphere";
import { SoundControls } from "./SoundControls";
import { RevealedLine, type RevealedLineHandle } from "./RevealedLine";
import { Dialog } from "./Dialog";
import { frameArt, loadArtwork } from "../data/screening-art";
import { GameError, type ScreeningView } from "../services/contract";
import type { useGame } from "../useGame";

type Game = ReturnType<typeof useGame>;
type ReadLine = { id: string; text: string; index: number };
export function ScreeningPlayer({
  game,
  onRecovery,
}: {
  game: Game;
  onRecovery: () => void;
}) {
  const latest = useRef(game);
  latest.current = game;
  const state = game.state!;
  const [view, setView] = useState<ScreeningView | null>(null);
  const [readError, setReadError] = useState("");
  const [reload, setReload] = useState(0);
  const [auto, setAuto] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [completedLine, setCompletedLine] = useState("");
  const lineKey = `${view?.playback?.run_id}:${view?.segment?.id}`;
  const textDone = completedLine === lineKey;
  const [narrationDone, setNarrationDone] = useState(false);
  const narrationTicket = useRef(0);
  const playNarration = useCallback((text: string) => {
    const ticket = ++narrationTicket.current;
    setNarrationDone(false);
    void speak(text, "narrator").finally(() => {
      if (narrationTicket.current === ticket) setNarrationDone(true);
    });
  }, []);
  const line = useRef<RevealedLineHandle>(null);
  const startedAt = useRef(0);
  const sending = useRef<string | null>(null);
  const logKey = `story-shop:film-log:${state.session_id}:${state.story_version}`;
  const [history, setHistory] = useState<ReadLine[]>(() => {
    try {
      const rows: unknown = JSON.parse(sessionStorage.getItem(logKey) || "[]");
      return Array.isArray(rows)
        ? rows
            .filter(
              (r): r is ReadLine =>
                typeof r?.id === "string" &&
                typeof r?.text === "string" &&
                Number.isInteger(r?.index) &&
                r.index <= (state.playback?.next_segment || 0),
            )
            .slice(-200)
        : [];
    } catch {
      return [];
    }
  });
  const recovery =
    game.needsResume || !!game.failed || !!game.error || !!readError;
  const ready =
    !recovery &&
    !game.busy &&
    !!view?.segment &&
    view.version === state.version;
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
          !next.segment ||
          !next.playback
        )
          throw new GameError(
            "VERSION_CONFLICT",
            "故事进度已有变化，请同步后继续。",
          );
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
        setAuto(false);
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
    startedAt.current = performance.now();
    sending.current = null;
    playNarration(view.segment.text);
    const entry: ReadLine = {
      id: view.segment.id,
      text: view.segment.text,
      index: view.playback.next_segment,
    };
    setHistory((previous) => {
      const next = [...previous.filter((r) => r.index < entry.index), entry];
      try {
        sessionStorage.setItem(logKey, JSON.stringify(next));
      } catch {
        /* Reading still works without storage. */
      }
      return next;
    });
    return () => {
      narrationTicket.current++;
      stopVoice();
    };
  }, [view, state.version, recovery, logKey, playNarration]);
  const commit = useCallback(
    (manual: boolean) => {
      if (
        !view?.segment ||
        !view.playback ||
        recovery ||
        latest.current.busy ||
        document.hidden ||
        view.version !== latest.current.state?.version
      )
        return;
      const key = `${view.playback.run_id}:${view.segment.id}:${view.version}`;
      if (sending.current === key) return;
      sending.current = key;
      stopVoice();
      void latest.current
        .run({
          type: "screening_progress",
          run_id: view.playback.run_id,
          segment_id: view.segment.id,
          ...(manual ? { advance_mode: "manual" as const } : {}),
        })
        .then((ok) => {
          if (!ok) {
            setAuto(false);
            latest.current.requireResume();
          }
        });
    },
    [view, recovery],
  );
  const advance = useCallback(() => {
    if (showHistory || !ready) return;
    if (hidden) {
      setHidden(false);
      return;
    }
    setAuto(false);
    // First press completes the current text; a second press commits exactly one unit.
    if (!line.current?.reveal()) return;
    commit(true);
  }, [ready, hidden, showHistory, commit]);
  useEffect(() => {
    if (
      !auto ||
      !ready ||
      hidden ||
      showHistory ||
      !textDone ||
      !narrationDone ||
      !view?.segment
    )
      return;
    const delay = Math.max(
      800,
      view.segment.duration_ms - (performance.now() - startedAt.current),
    );
    const timer = window.setTimeout(() => commit(false), delay);
    return () => clearTimeout(timer);
  }, [auto, ready, hidden, showHistory, textDone, narrationDone, view, commit]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input,textarea,select,dialog,[contenteditable='true']")
      )
        return;
      if (event.code === "KeyH" && ready && !showHistory) {
        event.preventDefault();
        setAuto(false);
        setHidden((v) => !v);
        return;
      }
      if (target?.closest("button")) return;
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        advance();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [advance, ready, showHistory]);
  const art = view?.segment
    ? frameArt(view.story_id, view.story_version, view.segment.id)
    : { src: null, kind: "paper" as const };
  return (
    <main
      className={`screening-room vn-player ${recovery ? "is-interrupted" : ""} ${hidden ? "dialogue-hidden" : ""}`}
      aria-label="故事放映"
      tabIndex={0}
      onClick={(event) => {
        if (
          !(event.target as HTMLElement).closest(
            "button,input,dialog,[role='group']",
          )
        )
          advance();
      }}
    >
      <div className="film-sound">
        <SoundControls />
      </div>
      <div className="film-topline">
        <span>故事旧货铺</span>
        <span>第一章 · 遗失的晴天</span>
      </div>
      <div className={`film-frame film-${art.kind}`} key={art.src || "paper"}>
        {art.src && <img src={art.src} alt="" className="film-art" />}
        <div className="film-shade" />
        {!view && !recovery && (
          <p className="film-loading" role="status">
            灯光暗下来了，故事即将开始…
          </p>
        )}
      </div>
      {view?.segment && view.playback && (
        <section
          className="film-caption vn-dialogue"
          data-testid="film-caption"
          data-segment={view.segment.id}
          aria-label="当前故事对白"
          aria-hidden={hidden}
        >
          <div className="vn-nameplate">
            旁白 <span>遗失的晴天</span>
          </div>
          <RevealedLine
            key={`${view.playback.run_id}:${view.segment.id}`}
            ref={line}
            text={view.segment.text}
            onComplete={() => setCompletedLine(lineKey)}
            showCaret={false}
          />
          <div className="vn-toolbar">
            <span className="vn-input-hint">
              {auto ? "自动阅读中" : "点击画面 · 空格 / Enter"}
            </span>
            <button
              aria-label="重听当前句"
              disabled={!ready || hidden}
              onClick={() => {
                playNarration(view.segment!.text);
              }}
            >
              <Volume2 size={13} />
              重听
            </button>
            <button
              aria-label="查看已读记录"
              disabled={hidden}
              onClick={() => {
                setAuto(false);
                setShowHistory(true);
              }}
            >
              <History size={13} />
              记录
            </button>
            <button
              aria-label="隐藏对白"
              disabled={hidden}
              onClick={() => {
                setAuto(false);
                setHidden(true);
              }}
            >
              <Eye size={13} />
              隐藏
            </button>
            <button
              aria-label="自动播放"
              aria-pressed={auto}
              disabled={!ready || hidden}
              onClick={() => setAuto((v) => !v)}
            >
              <Play size={12} />
              {auto ? "自动 · 开" : "自动"}
            </button>
            <button
              className={`vn-next ${textDone ? "is-ready" : ""}`}
              aria-label={textDone ? "下一句" : "显示完整对白"}
              disabled={!ready || hidden}
              onClick={advance}
            >
              <span>
                {game.busy
                  ? "翻页中"
                  : !textDone
                    ? "显示完整"
                    : view.playback.next_segment === view.total_segments - 1
                      ? "回到店铺"
                      : "下一句"}
              </span>
              <i aria-hidden="true">◆</i>
            </button>
          </div>
        </section>
      )}
      {hidden && (
        <button className="vn-show-dialogue" onClick={() => setHidden(false)}>
          显示对白 · H
        </button>
      )}
      <div className="film-bottomline">
        <span>一件旧物，一段晴天</span>
        <span>{auto ? "AUTO" : "按你的节奏，慢慢读"}</span>
      </div>
      {showHistory && (
        <Dialog
          title="刚刚读过的故事"
          eyebrow="已读记录"
          onClose={() => {
            stopVoice();
            setShowHistory(false);
          }}
        >
          <div className="vn-backlog">
            {history.map((entry) => (
              <article key={entry.id}>
                <small>旁白</small>
                <p>{entry.text}</p>
                <button
                  aria-label={`重听记录 ${entry.index + 1}`}
                  onClick={() => void speak(entry.text, "narrator")}
                >
                  <Volume2 size={14} />
                  重听
                </button>
              </article>
            ))}
          </div>
        </Dialog>
      )}
      {recovery && (
        <div className="screening-recovery" role="region" aria-label="恢复放映">
          <p className="eyebrow">故事还在这里</p>
          <h1>从停下的地方，继续。</h1>
          <p>{readError || "当前这一句会重新显示，已经读过的进度仍然保留。"}</p>
          {game.failed ? (
            <p>请先确认上次操作的结果，再继续。</p>
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
