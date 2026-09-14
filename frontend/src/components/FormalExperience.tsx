import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Camera,
  Feather,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { screeningArt, preloadFilm } from "../data/screening-art";
import { type Collection } from "../services/contract";
import type { useGame } from "../useGame";
import { Dialog } from "./Dialog";
import { CollectionAlbum } from "./CollectionAlbum";
import { ScreeningPlayer } from "./ScreeningPlayer";
import "./formal.css";
import "./immersive.css";
import { SoundControls } from "./SoundControls";
import { RevealedLine, type RevealedLineHandle } from "./RevealedLine";
import { useAtmosphere, useVoice, speak, stopVoice } from "../audio/atmosphere";

type Game = ReturnType<typeof useGame>;
type Panel =
  | "inspect"
  | "history"
  | "accept"
  | "collection"
  | "reset"
  | "recovery"
  | "help"
  | null;
export function FormalExperience({
  game,
  onHome,
  onChooseStory,
}: {
  game: Game;
  onHome: () => void;
  onChooseStory: () => void;
}) {
  const { state, meta, busy, error, failed, draft, health } = game;
  const sound = useAtmosphere();
  const [composeOpen, setComposeOpen] = useState(false);
  const [dialogueIndex, setDialogueIndex] = useState(0);
  const dialogueLine = useRef<RevealedLineHandle>(null);
  const dialogueText =
    state?.phase === "completed"
      ? "谢谢老板，我会把这件事告诉苏晚。那我先告辞了。"
      : state?.messages.at(-1)?.text || "";
  const dialoguePages = Array.from(
    dialogueText.match(/.{1,115}(?:[，。！？、；：”]|$)|.{1,115}/gu) || [
      dialogueText,
    ],
  );
  const pageText =
    dialoguePages[Math.min(dialogueIndex, dialoguePages.length - 1)] || "";
  useEffect(() => {
    setDialogueIndex(0);
  }, [dialogueText]);
  useVoice(pageText, state?.phase !== "screening", "kanshan", game.getVoice);
  const [panel, setPanel] = useState<Panel>(null);
  const [target, setTarget] = useState("camera_front");
  const [localError, setLocalError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [collection, setCollection] = useState<Collection | null>(
    state?.collection || null,
  );
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [arrival, setArrival] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const gate = useRef(false);
  const collectionRead = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    setRetryAt(Date.now() + (error?.retryAfter || 0) * 1000);
  }, [error]);
  useEffect(() => {
    if (now >= retryAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [now, retryAt]);
  useEffect(() => {
    if (!arrival) return;
    const id = setTimeout(() => setArrival(false), 3200);
    return () => clearTimeout(id);
  }, [arrival]);
  if (!state || !meta) return null;
  const completed = state.phase === "completed";
  const playing = state.phase === "screening";
  const changed =
    state.story_id !== meta.id || state.story_version !== meta.version;
  const blocked = busy || !!failed || preparing || changed || !!error;

  const mode =
    health?.ai_mode === "custom"
      ? "AI 对话模式"
      : health?.ai_mode === "scripted"
        ? "固定问答体验 · 自由 AI 待接入"
        : "模拟回应 · 未接真实 AI";
  const nonRetry = [
    "VERSION_CONFLICT",
    "INVALID_SESSION",
    "AUTH_REQUIRED",
    "STORY_VERSION_CHANGED",
    "SESSION_COMMAND_LIMIT",
    "TURN_LIMIT",
    "IDEMPOTENCY_CONFLICT",
    "INVALID_PHASE",
    "SCREENING_RUN_CHANGED",
    "SCREENING_OUT_OF_ORDER",
    "SESSION_COMPLETED",
    "AI_DAILY_LIMIT",
    "STORAGE_QUOTA",
    "SESSION_CAPACITY",
    "INVALID_REQUEST",
    "REQUEST_TOO_LARGE",
    "CONFIRMATION_REQUIRED",
  ];
  const questions = state.suggested_questions.length
    ? state.suggested_questions
    : state.phase === "before_screening" &&
        state.story_id === "lost-sunshine" &&
        state.story_version === "screening-v4.1"
      ? ["你和苏晚是什么关系？", "这是寄展，还是想卖给我？"]
      : [];
  const canSync = !playing || !failed || nonRetry.includes(error?.code || "");
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const close = () => {
    setPanel(null);
    setLocalError("");
    collectionRead.current++;
  };
  async function begin() {
    if (gate.current || blocked) return;
    gate.current = true;
    stopVoice();
    setComposeOpen(false);
    setPreparing(true);
    setLocalError("");
    const expected = stateRef.current;
    try {
      await preloadFilm(state!.story_id, state!.story_version);
      if (stateRef.current?.version === expected?.version)
        await game.run({ type: "screening_start", confirm: true });
    } catch {
      setLocalError("放映画面还没准备好，请检查网络后再次点击“听听故事”。");
    } finally {
      gate.current = false;
      setPreparing(false);
    }
  }
  async function ask(text = draft) {
    if (blocked || !text.trim()) return;
    game.setDraft(text);
    if (await game.run({ type: "chat", message: text.trim() }))
      setComposeOpen(false);
  }
  async function inspect(id: string) {
    setTarget(id);
    setPanel("inspect");
    setLocalError("");
    if (!state!.clues.some((x) => x.id === id) && !blocked && !completed)
      await game.run({ type: "inspect", target_id: id });
  }
  async function accept() {
    if (gate.current || blocked) return;
    gate.current = true;
    try {
      if (await game.run({ type: "collect", confirm: true })) {
        close();
        setArrival(true);
      }
    } finally {
      gate.current = false;
    }
  }
  async function showCollection() {
    setPanel("collection");
    setLocalError("");
    setCollection(state!.collection || null);
    setCollectionLoading(true);
    const request = ++collectionRead.current;
    const id = state!.session_id;
    try {
      const result = await game.getCollection();
      if (
        request === collectionRead.current &&
        stateRef.current?.session_id === id
      )
        setCollection(result);
    } catch {
      if (request === collectionRead.current)
        setLocalError("收藏暂时没能读回，请再次打开收藏册。");
    } finally {
      if (request === collectionRead.current) setCollectionLoading(false);
    }
  }
  const errors =
    error || failed || localError || changed ? (
      <div className="formal-error" role="alert">
        <p>
          {changed
            ? "故事版本已更新。已有收藏仍可回顾，继续新版需要确认重新开始。"
            : error?.message || localError || "上次操作的结果尚待确认。"}
        </p>
        {error?.traceId && <small>排查编号：{error.traceId}</small>}
        <div>
          {failed && !nonRetry.includes(error?.code || "") && (
            <button
              disabled={busy || wait > 0}
              onClick={() => {
                if (playing) game.requireResume();
                void game.retry();
              }}
            >
              {wait ? `${wait} 秒后可重试` : "重试这次操作"}
            </button>
          )}
          {canSync &&
            (error || failed) &&
            !["INVALID_SESSION", "AUTH_REQUIRED"].includes(
              error?.code || "",
            ) && (
              <button disabled={busy} onClick={() => void game.sync()}>
                同步已保存进度
              </button>
            )}
          {(changed ||
            [
              "INVALID_SESSION",
              "AUTH_REQUIRED",
              "TURN_LIMIT",
              "SESSION_COMMAND_LIMIT",
            ].includes(error?.code || "")) && (
            <button disabled={busy} onClick={() => setPanel("reset")}>
              重新开始
            </button>
          )}
        </div>
      </div>
    ) : null;
  return (
    <div
      className={`formal-experience immersive-game ${completed ? "chapter-complete" : ""}`}
    >
      {playing ? (
        <>
          <ScreeningPlayer
            game={game}
            onRecovery={() => setPanel("recovery")}
          />
          {errors && <div className="player-errors">{errors}</div>}
        </>
      ) : (
        <>
          <header className="formal-header">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onHome();
              }}
              className="formal-brand"
            >
              <Feather size={21} />
              <span>
                故事旧货铺<small>THE STORY SHOP</small>
              </span>
            </a>
            <nav aria-label="店铺导航">
              <button onClick={onChooseStory}>
                <BookOpen size={16} />
                <span>故事选择</span>
              </button>
              <button
                disabled={!state.collection}
                onClick={() => void showCollection()}
              >
                <BookOpen size={16} />
                <span>收藏</span>
                <small>{state.collection ? "01" : "00"}</small>
              </button>
              <SoundControls />
              <button
                aria-label="关于这次来访"
                onClick={() => setPanel("help")}
              >
                ···
              </button>
            </nav>
          </header>
          <main className="formal-main">
            <div className="formal-chapter">
              <p className="eyebrow">CHAPTER 01 · 一台相机，一段时光</p>
              <h1>{completed ? "故事有了归处。" : "遗失的晴天。"}</h1>
              <span className="chapter-caption">
                {completed
                  ? "旧物入店，故事入册"
                  : state.phase === "after_screening"
                    ? "灯光亮起，我们接着聊"
                    : "午后 · 故事旧货铺"}
              </span>
            </div>
            <div className="formal-stage" aria-label="旧货铺柜台">
              <div className="scene-canvas">
                <img
                  className="shop-background"
                  src={screeningArt.shop}
                  alt="暖光照进旧货铺，左侧是木质收藏柜"
                />
                <img
                  className={`shop-background collected-background ${completed ? "is-visible" : ""}`}
                  src={screeningArt.shopCollected}
                  alt=""
                  aria-hidden="true"
                />
                {(!completed || arrival) && (
                  <div
                    className={`visitor-puppet ${sound.speaking ? "is-speaking" : ""} ${completed ? "is-leaving" : ""}`}
                  >
                    <img
                      className={`shop-visitor expression-${state.expression}`}
                      src={screeningArt.visitor}
                      alt="看山，受苏晚委托而来的寄展办理人"
                    />
                  </div>
                )}
                <div className="counter-foreground" aria-hidden="true" />
                <button
                  className={`shop-camera ${completed ? "is-shelved" : ""}`}
                  disabled={blocked}
                  onClick={() =>
                    completed
                      ? void showCollection()
                      : void inspect("camera_front")
                  }
                  aria-label={completed ? "查看寄展相机" : "检查相机"}
                >
                  {!completed && (
                    <img src={screeningArt.camera} alt="木质老式相机" />
                  )}
                  <span>
                    {completed ? "01 · 遗失的晴天" : "相机 · 点击查看"}
                  </span>
                </button>
                {!completed && (
                  <button
                    className="shop-photos"
                    disabled={blocked}
                    onClick={() => void inspect("photo_stack")}
                    aria-label="检查照片"
                  >
                    <i />
                    <i />
                    <span>照片</span>
                  </button>
                )}
              </div>
              <div className="world-vignette" aria-hidden="true" />
              <div className="floating-motes" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            {arrival && (
              <div className="arrival-note" role="status">
                <span>收藏 +1</span>相机轻轻落在架上，这段晴天留了下来。
              </div>
            )}
            <section className="formal-dialogue" aria-label="与看山交谈">
              <div className="dialogue-heading">
                <span>{completed ? "看山 · 告别" : "看山"}</span>
                <small>{completed ? "故事已经留在这里" : "旧物的来访者"}</small>
                <button
                  aria-label="重听台词"
                  onClick={() => void speak(pageText, "kanshan", game.getVoice)}
                >
                  重听
                </button>
                <button
                  onClick={() => setPanel("history")}
                  aria-label="查看对话记录"
                >
                  <MessageCircle size={14} />
                  <span>手记</span>
                </button>
              </div>
              <div
                className="current-dialogue"
                onClick={() => {
                  if (
                    dialogueLine.current?.reveal() &&
                    dialogueIndex < dialoguePages.length - 1
                  )
                    setDialogueIndex((i) => i + 1);
                }}
                aria-live="polite"
                key={`${state.messages.length}:${dialogueIndex}:${completed}`}
              >
                <RevealedLine ref={dialogueLine} text={pageText} />
                {busy && game.lastAction === "chat" && (
                  <span className="reply-waiting">看山正在整理思绪…</span>
                )}
              </div>
              {errors}
              {dialogueIndex < dialoguePages.length - 1 ? (
                <div className="formal-actions">
                  <button
                    className="primary"
                    onClick={() => setDialogueIndex((i) => i + 1)}
                  >
                    继续听 <ArrowRight size={15} />
                  </button>
                </div>
              ) : completed ? (
                <div className="formal-actions completion-actions">
                  <button className="primary" onClick={onHome}>
                    返回主页 <ArrowRight size={16} />
                  </button>
                  <button onClick={() => void showCollection()}>
                    <BookOpen size={16} />
                    翻开收藏册
                  </button>
                </div>
              ) : (
                <>
                  <div className="formal-actions">
                    {state.phase === "before_screening" && (
                      <button
                        className="primary"
                        disabled={blocked}
                        onClick={() => void begin()}
                      >
                        {preparing ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <BookOpen size={16} />
                        )}{" "}
                        {preparing ? "画面准备中…" : "听听故事"}
                        <ArrowRight size={15} />
                      </button>
                    )}
                    {state.phase === "after_screening" && state.can_collect && (
                      <button
                        className="primary"
                        disabled={blocked}
                        onClick={() =>
                          state.collection ? void accept() : setPanel("accept")
                        }
                      >
                        {state.collection ? "结束本次体验" : "谈谈寄展"}{" "}
                        <ArrowRight size={15} />
                      </button>
                    )}
                    {questions.slice(0, 2).map((q) => (
                      <button
                        key={q}
                        disabled={blocked}
                        onClick={() => void ask(q)}
                      >
                        {q}
                      </button>
                    ))}
                    <button
                      className="free-question"
                      aria-expanded={composeOpen}
                      onClick={() => setComposeOpen((v) => !v)}
                    >
                      <Feather size={14} />
                      我想问…
                    </button>
                  </div>
                  {composeOpen && (
                    <form
                      className="formal-compose"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void ask();
                      }}
                    >
                      <label className="sr-only" htmlFor="formal-question">
                        向看山提问
                      </label>
                      <textarea
                        id="formal-question"
                        autoFocus
                        rows={1}
                        value={draft}
                        maxLength={2000}
                        placeholder="写下你想对看山说的话…"
                        onChange={(e) => game.setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing &&
                            e.keyCode !== 229
                          ) {
                            e.preventDefault();
                            void ask();
                          }
                        }}
                      />
                      <button
                        disabled={blocked || !draft.trim()}
                        aria-label="发送问题"
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : (
                          <Send size={17} />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="收起输入"
                        onClick={() => setComposeOpen(false)}
                      >
                        <X size={16} />
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
            <footer className="formal-footer">
              <span>
                自动保存 ·{" "}
                {health?.ai_mode === "custom" ? "AI 对话" : "固定问答"}
              </span>
              <button onClick={() => setPanel("reset")}>
                <RotateCcw size={12} />
                重新开始
              </button>
            </footer>
            {game.saveNotice && (
              <p className="save-notice" role="alert">
                {game.saveNotice}
              </p>
            )}
          </main>
        </>
      )}
      {panel === "inspect" && !playing && (
        <Dialog
          title={target === "camera_front" ? "苏晚的相机" : "带来的照片"}
          eyebrow="柜台上的旧物"
          onClose={close}
        >
          {target === "camera_front" ? (
            <img
              className="inspect-camera"
              src={screeningArt.camera}
              alt="木质老式相机"
            />
          ) : state.phase === "before_screening" ? (
            <div className="unopened-photos">一叠尚待讲述的照片</div>
          ) : (
            <div className="photo-review">
              <img src={screeningArt.street} alt="老街的女孩" />
              <img src={screeningArt.photo} alt="江边照片" />
              <img src={screeningArt.note} alt="希望我的女孩，永远拥有晴天。" />
            </div>
          )}
          <p className="inspect-description">
            {state.clues.find((x) => x.id === target)?.text ||
              (busy ? "正在留意这件旧物…" : "细节尚未记入手记。")}
          </p>
          {errors}
          <div className="formal-actions">
            {meta.inspection_targets.map((x) => (
              <button
                key={x.id}
                disabled={blocked}
                onClick={() => void inspect(x.id)}
              >
                {x.label}
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {panel === "history" && !playing && (
        <Dialog title="这次来访的手记" onClose={close}>
          <div className="formal-history" role="log">
            {state.messages.map((m, i) => (
              <div key={i}>
                <small>{m.role === "user" ? "你 · 店主" : "看山"}</small>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
          <h3>旧物细节</h3>
          {state.clues.length ? (
            state.clues.map((c) => (
              <p className="inspect-description" key={c.id}>
                {c.text}
              </p>
            ))
          ) : (
            <p className="inspect-description">还没有记下物件细节。</p>
          )}
        </Dialog>
      )}
      {panel === "accept" && !playing && (
        <Dialog
          title="为这段故事，留一个位置。"
          eyebrow="寄展确认"
          onClose={() => {
            if (!busy) close();
          }}
        >
          <img
            className="accept-camera"
            src={screeningArt.camera}
            alt="待接收的相机"
          />
          <p className="inspect-description">
            接收相机与相关照片的寄展，让《遗失的晴天》留在店里。
          </p>
          <dl className="consignment-details">
            <div>
              <dt>物件所有人</dt>
              <dd>{meta.owner}</dd>
            </div>
            <div>
              <dt>寄展办理人</dt>
              <dd>{meta.custodian}</dd>
            </div>
            <div>
              <dt>接收方</dt>
              <dd>{meta.recipient}</dd>
            </div>
          </dl>
          <p className="formal-input-note">寄展不会改变物件所有权。</p>
          {errors}
          <div className="formal-actions">
            <button disabled={busy} onClick={close}>
              再想一想
            </button>
            <button
              className="primary"
              disabled={blocked}
              onClick={() => void accept()}
            >
              确认接收寄展
            </button>
          </div>
        </Dialog>
      )}
      {panel === "collection" && !playing && (
        <CollectionAlbum
          collection={collection}
          loading={collectionLoading}
          error={localError}
          onClose={close}
        />
      )}
      {(panel === "reset" || panel === "recovery") && (
        <Dialog
          title={panel === "reset" ? "重新开始这次来访？" : "放映恢复"}
          onClose={close}
        >
          <p className="inspect-description">
            {panel === "reset"
              ? "这会清空本次体验和收藏，回到故事开场。只有你确认后才会执行。"
              : "中断不会补报字幕或跳过未看完的内容。先处理未决操作，再从未完成的一幕继续。"}
          </p>
          {errors}
          <div className="formal-actions">
            {panel === "recovery" ? (
              <>
                <button
                  disabled={busy || !canSync}
                  onClick={() => {
                    void game.sync().then(close);
                  }}
                >
                  同步进度
                </button>
                <button onClick={() => setPanel("reset")}>重新开始</button>
              </>
            ) : (
              <>
                <button onClick={close}>保留当前进度</button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    void (
                      error?.code === "SESSION_COMMAND_LIMIT"
                        ? game.start(true)
                        : game.reset()
                    ).then((ok) => {
                      if (ok) {
                        setCollection(null);
                        close();
                      }
                    });
                  }}
                >
                  确认重新开始
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
      {panel === "help" && !playing && (
        <Dialog title="听故事，也给故事一个归处。" onClose={close}>
          <div className="inspect-description">
            <p>你是这间旧货铺的老板。看山受苏晚委托，带来相机与照片寄展。</p>
            <p>
              准备好后点击“听听故事”。默认由你点击画面或按空格、Enter
              推进：第一下补全文字，再按一下进入下一句。也可以开启自动阅读，或查看已读记录、隐藏对白欣赏画面。音乐和配音可独立调整；故事结束后再决定是否接收寄展。
            </p>
            <p>
              {mode}。现有图片已接入，镜头映射仍待团队确认；原文来源尚在核对。
            </p>
            <p>
              此浏览器保存匿名会话；清除浏览器存储后无法找回。重新开始会清空本次体验与收藏。
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
