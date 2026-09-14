import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  Feather,
  FolderHeart,
  Lightbulb,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { CameraArt, Kanshan, MemoryArt, ShopScene } from "./components/Artwork";
import { Dialog } from "./components/Dialog";
import { ArtSlot } from "./components/ArtSlot";
import { artAssets } from "./data/assets";
import { gateway, storagePrefix } from "./services";
import { MockGateway } from "./services/mock";
import { source } from "./data/chapter";
import type { StoryPage } from "./services/contract";
import { StoryHome } from "./components/StoryHome";
import { FormalExperience } from "./components/FormalExperience";
import { screeningArt } from "./data/screening-art";
import { stopVoice, useSoundLifecycle } from "./audio/atmosphere";
import { SoundControls } from "./components/SoundControls";
import { useGame } from "./useGame";

type Panel =
  | "inspect"
  | "clues"
  | "stories"
  | "collection"
  | "accept"
  | "reset"
  | "help"
  | "story"
  | "arrival"
  | null;
export default function App() {
  useSoundLifecycle();
  const game = useGame();
  const [screen, setScreen] = useState<"home" | "stories" | "play">("home");
  const goHome = () => {
    stopVoice();
    setPanel(null);
    setScreen("home");
  };
  const { state, meta, busy, error, failed, draft, setDraft } = game;
  const [panel, setPanel] = useState<Panel>(null);
  useEffect(() => {
    document.title =
      screen === "play" && meta?.title
        ? `故事旧货铺 · ${meta.title}`
        : "故事旧货铺";
  }, [screen, meta?.title]);
  const [target, setTarget] = useState("camera_front");
  const [photo, setPhoto] = useState(0);
  const [page, setPage] = useState<StoryPage | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [armed, setArmed] = useState(false);
  const [localNote, setLocalNote] = useState("");
  const [zoom, setZoom] = useState(false);
  const messages = useRef<HTMLDivElement>(null);
  const pageRequest = useRef(0);
  const blocked = busy || !!failed;
  const complete = state?.status === "completed";
  const close = () => {
    setPanel(null);
    setZoom(false);
    pageRequest.current++;
  };
  useEffect(() => {
    if (messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [state?.messages.length, busy]);
  useEffect(() => {
    if (panel !== "arrival") return;
    const timer = setTimeout(() => setPanel("collection"), 2800);
    return () => clearTimeout(timer);
  }, [panel]);
  async function inspect(id: string) {
    setTarget(id);
    setPanel("inspect");
    setZoom(false);
    if (!state?.clues.some((clue) => clue.id === id) && !blocked && !complete)
      await game.run({ type: "inspect", target_id: id });
  }
  async function send(text = draft) {
    if (!text.trim() || blocked || complete) return;
    setDraft(text);
    await game.run({ type: "chat", message: text.trim() });
    setArmed(false);
  }
  async function openPage(id: string) {
    const request = ++pageRequest.current;
    setPanel("story");
    setPage(null);
    setPageError("");
    setPageLoading(true);
    try {
      const incoming = await game.getPage(id);
      if (request !== pageRequest.current) return;
      let position = 0;
      try {
        position =
          JSON.parse(
            localStorage.getItem(`${storagePrefix}:page-position`) || "{}",
          )[id] || 0;
      } catch {
        /* Start from first segment if unavailable. */
      }
      setPageIndex(
        Math.min(Math.max(0, position), incoming.text.split("\n\n").length - 1),
      );
      setPage(incoming);
    } catch {
      if (request === pageRequest.current)
        setPageError("故事片段暂时没能打开，请返回目录重试。");
    } finally {
      if (request === pageRequest.current) setPageLoading(false);
    }
  }
  function changeSegment(index: number) {
    setPageIndex(index);
    try {
      const positions = JSON.parse(
        localStorage.getItem(`${storagePrefix}:page-position`) || "{}",
      );
      positions[page!.id] = index;
      localStorage.setItem(
        `${storagePrefix}:page-position`,
        JSON.stringify(positions),
      );
    } catch {
      setLocalNote("阅读位置暂时无法保存。");
    }
  }
  const currentClue = state?.clues.find((clue) => clue.id === target);
  const title = meta?.title || "遗失的晴天";
  const pageLabel = (id: string) =>
    gateway.mode === "mock"
      ? { old_street: "风铃响起的地方", sunny_day: "遗失的晴天" }[id] ||
        "故事片段"
      : "已解锁的故事片段";
  const newlyAvailable =
    state?.unlocked_pages.filter((id) => !state.read_pages.includes(id)) || [];
  const errorActions = (
    <>
      {failed &&
        ![
          "VERSION_CONFLICT",
          "INVALID_SESSION",
          "AUTH_REQUIRED",
          "STORY_VERSION_CHANGED",
          "TURN_LIMIT",
          "IDEMPOTENCY_CONFLICT",
        ].includes(error?.code || "") && (
          <button onClick={() => void game.retry()} disabled={busy}>
            <RotateCcw size={14} />
            重试这次操作
          </button>
        )}
      {failed &&
        !["INVALID_SESSION", "AUTH_REQUIRED"].includes(error?.code || "") && (
          <button onClick={() => void game.sync()} disabled={busy}>
            同步已保存进度
          </button>
        )}
      {[
        "INVALID_SESSION",
        "AUTH_REQUIRED",
        "STORY_VERSION_CHANGED",
        "TURN_LIMIT",
      ].includes(error?.code || "") && (
        <button onClick={() => setPanel("reset")} disabled={busy}>
          重新开始
        </button>
      )}
      {!state &&
        !failed &&
        !["INVALID_SESSION", "AUTH_REQUIRED"].includes(error?.code || "") && (
          <button onClick={() => void game.start()} disabled={busy}>
            重试进入
          </button>
        )}
    </>
  );
  if (screen !== "play" && gateway.mode === "http")
    return (
      <StoryHome
        game={game}
        view={screen}
        onSelect={() => setScreen("stories")}
        onHome={goHome}
        onEnter={() => setScreen("play")}
      />
    );
  if (
    state &&
    (meta?.flow === "screening" ||
      (state.phase &&
        state.phase !== "exploration" &&
        state.story_id === "lost-sunshine"))
  )
    return (
      <FormalExperience
        game={game}
        onHome={goHome}
        onChooseStory={() => {
          stopVoice();
          setScreen("stories");
        }}
      />
    );
  return (
    <div className={`app-shell ${!state ? "immersive-welcome" : ""}`}>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(event) => event.preventDefault()}
          aria-label="故事旧货铺"
        >
          <span className="brand-mark">
            <Feather size={23} />
          </span>
          <span>
            故事旧货铺<small>THE STORY SHOP</small>
          </span>
        </a>
        <nav aria-label="店铺导航">
          <SoundControls />
          <span className="mode-label">
            <span className="tiny-dot" />
            {gateway.mode === "mock"
              ? "本地交互样例 · 未接 AI"
              : state?.is_test_fixture
                ? "后端测试章节"
                : "故事体验"}
          </span>
          <button onClick={() => setPanel("collection")}>
            <BookOpen size={18} />
            <span>收藏册</span>
            <span className="count">{state?.collection ? "01" : "00"}</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setPanel("help")}
            aria-label="玩法与说明"
          >
            <CircleHelp size={19} />
          </button>
        </nav>
      </header>
      <p className="mobile-mode">
        <span className="tiny-dot" />
        {gateway.mode === "mock"
          ? "本地交互样例 · 预设回应，尚未接入真实 AI"
          : "服务接口模式 · 测试剧情与模拟 AI"}
      </p>
      {!state ? (
        <main className="welcome">
          <div className="welcome-copy">
            <p className="eyebrow">
              <span /> 一间小店，收留时光
            </p>
            <h1>
              每一件旧物，
              <br />
              都有话想<span>说。</span>
            </h1>
            <p className="intro">
              推开门，做一会儿店主。
              <br />
              看看旧物，听听看山，给故事留一个位置。
            </p>
            <button
              className="primary start-button"
              disabled={busy}
              onClick={() => void game.start()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Feather size={18} />
              )}{" "}
              {game.hasSave ? "继续上次的故事" : "推门营业"}
              <ArrowRight size={18} />
            </button>
            <p className="welcome-note">
              第一件旧物 · 老式相机<span>慢慢来，不用急着寻找答案。</span>
            </p>
          </div>
          <div className="welcome-scene">
            <div className="formal-welcome-art">
              <img src={screeningArt.shop} alt="阳光照进故事旧货铺" />
              <img
                className="welcome-visitor"
                src={screeningArt.visitor}
                alt="带着故事而来的看山"
              />
            </div>
            <div className="paper-tag">
              <span>今日来访</span>
              <strong>遗失的晴天</strong>
              <small>一台相机，一段遗失的时光。</small>
            </div>
          </div>
          {error && (
            <div className="error-banner welcome-error" role="alert">
              <span>{error.message}</span>
              {errorActions}
            </div>
          )}
        </main>
      ) : (
        <main className="game-main">
          <section className="chapter-heading">
            <div>
              <p className="eyebrow">
                第一件旧物 <span className="line" />{" "}
                {gateway.mode === "mock"
                  ? "一段关于重逢的故事"
                  : "后端测试剧情"}
              </p>
              <h1>
                {title}
                <span className="title-dot">。</span>
              </h1>
            </div>
            <div className="chapter-note">
              <Sun size={22} />
              <p>
                把时间放慢一点，
                <br />
                有些故事，值得好好听。
              </p>
            </div>
          </section>
          <div className="play-layout">
            <section className="scene-area" aria-label="旧货铺场景">
              <ShopScene
                collected={!!state.collection}
                expression={state.expression}
                busy={blocked}
                onInspect={() =>
                  void inspect(
                    meta?.inspection_targets[0]?.id || "camera_front",
                  )
                }
                onCollection={() => setPanel("collection")}
              />
              <div className="desk-toolbar">
                <button
                  disabled={blocked && !complete}
                  onClick={() =>
                    complete
                      ? setPanel("collection")
                      : void inspect(
                          meta?.inspection_targets[0]?.id || "camera_front",
                        )
                  }
                >
                  <Search size={19} />
                  <span>
                    {complete ? "查看寄展" : "检查旧物"}
                    <small>{meta?.item_name || "当前物件"}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
                <button onClick={() => setPanel("clues")}>
                  <Feather size={19} />
                  <span>
                    线索手记
                    <small>
                      {state.clues.length
                        ? `已记录 ${state.clues.length} 处细节`
                        : "留意不起眼的细节"}
                    </small>
                  </span>
                  <span className="count">
                    {String(state.clues.length).padStart(2, "0")}
                  </span>
                </button>
                <button onClick={() => setPanel("stories")}>
                  <BookOpen size={19} />
                  <span>
                    故事片段
                    <small>
                      {newlyAvailable.length
                        ? `${newlyAvailable.length} 段尚未阅读`
                        : state.unlocked_pages.length
                          ? "翻看相遇的时刻"
                          : "随着交谈慢慢展开"}
                    </small>
                  </span>
                  {newlyAvailable.length ? (
                    <span className="unread-dot" />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                </button>
              </div>
              <p className="scene-footnote">
                <span>
                  {state.messages.length === 1 && !state.clues.length
                    ? "点击相机寻找线索，也可以直接向看山提问。"
                    : "“旧物有期，故事无价。”"}
                </span>
                <span>场景与角色为开发占位</span>
              </p>
            </section>
            <section className="conversation" aria-label="与看山交谈">
              <header>
                <div className="avatar">
                  <Kanshan expression={state.expression} />
                </div>
                <div>
                  <h2>{complete ? "本次来访已结束" : "看山"}</h2>
                  <p>
                    <span className="tiny-dot" />
                    {complete
                      ? "故事已经有了归处"
                      : gateway.mode === "mock"
                        ? "受苏晚之托，带着故事而来"
                        : "受托讲述者 · 测试章节"}
                  </p>
                </div>
                <MessageCircle size={20} />
              </header>
              <div
                className="messages"
                ref={messages}
                role="log"
                aria-label="对话记录"
                aria-live="polite"
              >
                <div className="conversation-time">
                  {complete ? "旧物入店 · 故事入册" : "今日 · 一次新的相遇"}
                </div>
                {state.messages.map((message, index) => (
                  <div
                    key={`${state.session_id}-${index}`}
                    className={`message ${message.role}`}
                  >
                    <span className="speaker">
                      {message.role === "user" ? "你 · 店主" : "看山"}
                    </span>
                    <p>{message.text}</p>
                  </div>
                ))}
                {busy && game.lastAction === "chat" && (
                  <div className="message assistant waiting">
                    <span className="speaker">看山</span>
                    <p>
                      <i />
                      <i />
                      <i />
                      <span>正在整理这段回忆…</span>
                    </p>
                  </div>
                )}
                {complete && (
                  <div className="goodbye">
                    <Feather size={19} />
                    <p>
                      谢谢你，愿意给这段时光留一个位置。
                      <br />
                      我们下次见。
                    </p>
                  </div>
                )}
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  <span>{error.message}</span>
                  {errorActions}
                  {error.traceId && <small>排查编号：{error.traceId}</small>}
                </div>
              )}
              {!complete ? (
                <div className="compose-area">
                  {newlyAvailable.length > 0 && !busy && (
                    <button
                      className="new-story"
                      onClick={() => void openPage(newlyAvailable[0])}
                    >
                      <BookOpen size={16} /> 有一段回忆，可以翻开了{" "}
                      <ArrowRight size={15} />
                    </button>
                  )}
                  <div className="suggestion-heading">
                    <span>不妨问问</span>
                    <button
                      disabled={blocked}
                      onClick={() => void send("给我一点提示")}
                    >
                      <Lightbulb size={13} /> 给我一点提示
                    </button>
                  </div>
                  <div className="suggestions">
                    {state.suggested_questions.slice(0, 3).map((question) => (
                      <button
                        key={question}
                        disabled={blocked}
                        onClick={() => void send(question)}
                      >
                        {question}
                        <ArrowRight size={13} />
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void send();
                    }}
                  >
                    <label className="sr-only" htmlFor="question">
                      向看山提问
                    </label>
                    <textarea
                      id="question"
                      rows={2}
                      value={draft}
                      maxLength={2000}
                      placeholder="你想问看山些什么？"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing &&
                          event.keyCode !== 229
                        ) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button
                      className="send-button"
                      disabled={blocked || !draft.trim()}
                      aria-label="发送问题"
                    >
                      {busy ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <Send size={18} />
                      )}
                    </button>
                  </form>
                  <div className="input-footer">
                    <span>
                      {draft.length
                        ? `${draft.length} / 2000`
                        : "想到什么，都可以问。"}
                    </span>
                    <span>Enter 发送 · Shift + Enter 换行</span>
                  </div>
                  {state.can_collect && (
                    <button
                      className="primary accept-button"
                      disabled={blocked}
                      onClick={() => setPanel("accept")}
                    >
                      <FolderHeart size={17} /> 为这段故事留个位置{" "}
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="ending-actions">
                  <button
                    className="primary"
                    onClick={() => setPanel("collection")}
                  >
                    <BookOpen size={17} />
                    打开收藏册
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setPanel("reset")}
                  >
                    重新开始这段故事
                  </button>
                </div>
              )}
            </section>
          </div>
          {game.saveNotice && (
            <p className="storage-notice" role="status">
              {game.saveNotice}
            </p>
          )}
          <footer className="game-footer">
            <span>
              <Check size={13} />{" "}
              {busy
                ? "正在记录…"
                : gateway.mode === "mock"
                  ? "进度保存在此浏览器"
                  : "显示最近确认的进度"}
            </span>
            <div>
              {gateway.mode === "mock" && (
                <button
                  disabled={blocked || complete}
                  onClick={() => {
                    if (gateway instanceof MockGateway) gateway.failNext = true;
                    setArmed(true);
                  }}
                >
                  {armed ? "已设置：下次操作失败" : "演示：模拟一次失败"}
                </button>
              )}
              <button onClick={() => setPanel("reset")} disabled={busy}>
                <RotateCcw size={13} />
                重新开始
              </button>
            </div>
          </footer>
        </main>
      )}
      {panel === "inspect" && (
        <Dialog
          title="把旧物拿近一些"
          eyebrow="仔细看看 · 物件检查"
          onClose={close}
          wide
        >
          <div className="inspect-tabs" role="group" aria-label="检查位置">
            {meta?.inspection_targets.map((item) => (
              <button
                key={item.id}
                className={target === item.id ? "selected" : ""}
                disabled={blocked || complete}
                onClick={() => void inspect(item.id)}
              >
                {item.label}
                {state?.clues.some((clue) => clue.id === item.id) && (
                  <Check size={14} />
                )}
              </button>
            ))}
          </div>
          <div className="inspection-body">
            <div className={`object-view ${zoom ? "zoomed" : ""}`}>
              {target === "camera_front" ? (
                <CameraArt />
              ) : target === "photo_back" ? (
                <ArtSlot
                  src={artAssets.photo.back}
                  alt="照片背面"
                  className="photo-back-image"
                >
                  <div className="photo-back">
                    <span>
                      {gateway.mode === "mock" ? (
                        <>
                          希望我的女孩，
                          <br />
                          永远拥有晴天。
                        </>
                      ) : (
                        "照片背面"
                      )}
                    </span>
                    <small>
                      {gateway.mode === "mock"
                        ? "没有署名 · 没有日期"
                        : "等待对应章节素材"}
                    </small>
                  </div>
                </ArtSlot>
              ) : (
                <div className="photo-print">
                  <MemoryArt
                    scene={photo === 0 ? "street" : "sunny"}
                    purpose="photo"
                  />
                  <span>{photo === 0 ? "老街的梧桐树下" : "傍晚的江边"}</span>
                </div>
              )}
              <button
                className="zoom-button icon-button"
                aria-label={zoom ? "缩小物件" : "放大物件"}
                onClick={() => setZoom(!zoom)}
              >
                <Maximize2 size={17} />
              </button>
            </div>
            <div className="object-details">
              <p className="eyebrow">
                {target === "camera_front"
                  ? "一台老式相机"
                  : "一张留下来的照片"}
              </p>
              <h3>
                {
                  meta?.inspection_targets.find((item) => item.id === target)
                    ?.label
                }
              </h3>
              {currentClue ? (
                <>
                  <p className="clue-text">{currentClue.text}</p>
                  <span className="recorded">
                    <Check size={14} />
                    已记入线索手记
                  </span>
                </>
              ) : (
                <p className="clue-text">
                  {busy ? "正在记录眼前的细节…" : "尚未完成检查，请重试。"}
                </p>
              )}
              {target === "photo_front" && (
                <div className="photo-controls">
                  <button
                    className="icon-button"
                    onClick={() => setPhoto(1 - photo)}
                    aria-label="上一张照片"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>{photo + 1} / 2</span>
                  <button
                    className="icon-button"
                    onClick={() => setPhoto(1 - photo)}
                    aria-label="下一张照片"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}
              {target !== "camera_front" &&
                meta?.inspection_targets.some(
                  (item) =>
                    item.id ===
                    (target === "photo_back" ? "photo_front" : "photo_back"),
                ) && (
                  <button
                    className="secondary"
                    disabled={blocked}
                    onClick={() =>
                      void inspect(
                        target === "photo_back" ? "photo_front" : "photo_back",
                      )
                    }
                  >
                    <RotateCcw size={16} />
                    翻到{target === "photo_back" ? "正" : "背"}面
                  </button>
                )}
              <button className="text-button" onClick={close}>
                <ArrowLeft size={15} />
                放回柜台，继续聊聊
              </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error.message}</span>
              {errorActions}
            </div>
          )}
        </Dialog>
      )}
      {panel === "clues" && (
        <Dialog
          title="线索手记"
          eyebrow="所见与所闻，都留在这里"
          onClose={close}
        >
          <div className="notebook">
            <h3>
              <Eye size={18} />
              物件上看到的
            </h3>
            {state?.clues.length ? (
              state.clues.map((clue, index) => (
                <article key={clue.id}>
                  <span className="entry-number">0{index + 1}</span>
                  <p>{clue.text}</p>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Feather />
                <p>
                  手记还是空白的。
                  <br />
                  先看看柜台上的相机吧。
                </p>
              </div>
            )}
            <h3>
              <MessageCircle size={18} />
              看山讲述的
            </h3>
            <p className="muted small">
              保留讲述原话；你的猜测不会自动记成事实。
            </p>
            {state?.messages
              .filter((message) => message.role === "assistant")
              .map((message, i) => (
                <article key={i}>
                  <p>{message.text}</p>
                </article>
              ))}
          </div>
        </Dialog>
      )}
      {panel === "stories" && (
        <Dialog
          title="慢慢展开的故事"
          eyebrow="那些被时光留下的片段"
          onClose={close}
        >
          {state?.unlocked_pages.length ? (
            <div className="story-list">
              {state.unlocked_pages.map((id, i) => (
                <button key={id} onClick={() => void openPage(id)}>
                  <span className="entry-number">0{i + 1}</span>
                  <div>
                    <strong>{pageLabel(id)}</strong>
                    <small>
                      {state.read_pages.includes(id)
                        ? "已读 · 随时重温"
                        : "未读 · 一段新回忆"}
                    </small>
                  </div>
                  <ArrowRight size={18} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <BookOpen size={34} />
              <h3>回忆还没有翻开</h3>
              <p>
                检查旧物，或与看山聊聊。
                <br />
                当故事说到那里，片段就会出现在这里。
              </p>
              <button className="secondary" onClick={close}>
                回去聊聊
              </button>
            </div>
          )}
        </Dialog>
      )}
      {panel === "story" && (
        <Dialog
          title={page?.title || "打开一段回忆"}
          eyebrow="故事片段"
          onClose={close}
          wide
        >
          <div className="story-page">
            <div className="story-illustration">
              <MemoryArt
                scene={page?.id === "sunny_day" ? "sunny" : "street"}
              />
              <small>插图占位 · 等待美术替换</small>
            </div>
            <div className="story-prose">
              {pageLoading ? (
                <p>
                  <LoaderCircle size={20} className="spin" />
                  正在翻开这段回忆…
                </p>
              ) : pageError ? (
                <div role="alert">
                  <p>{pageError}</p>
                  <button
                    className="secondary"
                    onClick={() => setPanel("stories")}
                  >
                    返回片段目录
                  </button>
                </div>
              ) : (
                page && (
                  <>
                    <p className="page-number">
                      {String(pageIndex + 1).padStart(2, "0")} /{" "}
                      {String(page.text.split("\n\n").length).padStart(2, "0")}
                    </p>
                    <p
                      className="story-paragraph"
                      key={`${page.id}-${pageIndex}`}
                    >
                      {page.text.split("\n\n")[pageIndex]}
                    </p>
                    <div className="story-pagination">
                      <button
                        className="icon-button"
                        disabled={pageIndex === 0}
                        onClick={() => changeSegment(pageIndex - 1)}
                        aria-label="上一段"
                      >
                        <ArrowLeft size={18} />
                      </button>
                      {pageIndex < page.text.split("\n\n").length - 1 ? (
                        <button
                          className="primary"
                          onClick={() => changeSegment(pageIndex + 1)}
                        >
                          继续读
                          <ArrowRight size={17} />
                        </button>
                      ) : (
                        <button
                          className="primary"
                          disabled={blocked}
                          onClick={async () => {
                            if (
                              state?.read_pages.includes(page.id) ||
                              (await game.run({
                                type: "read",
                                page_id: page.id,
                              }))
                            )
                              close();
                          }}
                        >
                          {busy ? "正在记录…" : "读完了，回到店铺"}
                          <Check size={17} />
                        </button>
                      )}
                    </div>
                    <button className="text-button" onClick={close}>
                      先回店铺，稍后再读
                    </button>
                  </>
                )
              )}
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error.message}</span>
              {errorActions}
            </div>
          )}
          {localNote && <p role="status">{localNote}</p>}
        </Dialog>
      )}
      {panel === "collection" && (
        <Dialog
          title="故事收藏册"
          eyebrow="旧物入店 · 故事入册"
          onClose={close}
          wide
        >
          {state?.collection ? (
            <div className="collection-page">
              <div className="collection-object">
                <CameraArt />
                <span className="exhibit-stamp">
                  寄展
                  <br />
                  留念
                </span>
                <small>
                  No. 001 ·{" "}
                  {gateway.mode === "mock" ? "所有权属于苏晚" : "测试寄展物件"}
                </small>
              </div>
              <div>
                <p className="eyebrow">已接收寄展</p>
                <h3>{state.collection.item_name}</h3>
                <p className="collection-summary">{state.collection.summary}</p>
                <div className="source-note">
                  <p>原作者：待产品补充</p>
                  <p>原文入口：待提供原文链接</p>
                  <p>来源与授权记录：待产品确认</p>
                  <p>
                    {gateway.mode === "mock"
                      ? source.adaptation
                      : "改编说明：待产品与后端提供。"}
                  </p>
                </div>
                <h4>已发现的细节</h4>
                {state.clues.length ? (
                  state.clues.map((clue) => (
                    <p className="collection-clue" key={clue.id}>
                      <Check size={14} />
                      {clue.text}
                    </p>
                  ))
                ) : (
                  <p className="muted">本次没有检查额外细节。</p>
                )}
                <button
                  className="secondary"
                  onClick={() => setPanel("stories")}
                >
                  <BookOpen size={16} />
                  重读已发现的故事
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <FolderHeart size={40} />
              <h3>给下一个故事，留一个位置</h3>
              <p>
                理解旧物背后的经历，接收寄展后，
                <br />
                它和它的故事就会留在这里。
              </p>
              <button className="secondary" onClick={close}>
                回到店铺
              </button>
            </div>
          )}
        </Dialog>
      )}
      {panel === "accept" && (
        <Dialog title="为这段故事留个位置？" eyebrow="接收寄展" onClose={close}>
          <div className="confirm-content">
            <CameraArt />
            <p>
              接收后，本次来访将结束；
              <br />
              你仍可回顾已发现的故事。
            </p>
            <small>
              {gateway.mode === "mock"
                ? "相机属于苏晚，我们只是替她保管这段时光。"
                : "此处接收的是后端测试配置中的寄展物件。"}
            </small>
            <div className="confirm-actions">
              <button className="secondary" onClick={close}>
                再聊一会儿
              </button>
              <button
                className="primary"
                disabled={blocked || !state?.can_collect}
                onClick={async () => {
                  if (await game.run({ type: "collect" })) setPanel("arrival");
                }}
              >
                {busy ? "正在记录寄展…" : "确认接收寄展"}
                <Check size={17} />
              </button>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                <span>{error.message}</span>
                {errorActions}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {panel === "arrival" && (
        <Dialog
          title="旧物有了新的归处"
          eyebrow="谢谢你，愿意好好听"
          onClose={close}
        >
          <div className="arrival-animation">
            <CameraArt />
            <div className="arrival-shelf" />
            <Sparkles size={30} />
            <p>相机入店，故事入册。</p>
            <button
              className="secondary"
              onClick={() => setPanel("collection")}
            >
              跳过动效，打开收藏册
              <ArrowRight size={16} />
            </button>
          </div>
        </Dialog>
      )}
      {panel === "reset" && (
        <Dialog
          title="重新开始这段故事？"
          eyebrow="开始新的体验"
          onClose={close}
        >
          <div className="confirm-content">
            <RotateCcw size={32} />
            <p>
              重新开始将清空本次体验的
              <br />
              对话、线索与收藏记录。
            </p>
            {failed && (
              <p className="muted small">
                有一次操作结果待确认，请先同步进度，再重新开始。
              </p>
            )}
            <div className="confirm-actions">
              <button className="secondary" onClick={close}>
                保留当前进度
              </button>
              <button
                className="primary danger"
                disabled={busy}
                onClick={async () => {
                  if (await game.reset()) {
                    setPhoto(0);
                    setPage(null);
                    setPageIndex(0);
                    close();
                  }
                }}
              >
                {busy ? "正在处理…" : "确认重新开始"}
              </button>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                <span>{error.message}</span>
                {errorActions}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {panel === "help" && (
        <Dialog
          title="在小店里，慢慢来"
          eyebrow="给第一次来访的你"
          onClose={close}
        >
          <div className="help-content">
            <article>
              <Search />
              <div>
                <h3>看看旧物</h3>
                <p>
                  点击柜台上的相机。观察机身，翻翻照片，发现会记在线索手记里。
                </p>
              </div>
            </article>
            <article>
              <MessageCircle />
              <div>
                <h3>聊聊故事</h3>
                <p>向看山提问，也可以使用建议问题。检查和交谈可以随时交替。</p>
              </div>
            </article>
            <article>
              <BookOpen />
              <div>
                <h3>留住时光</h3>
                <p>阅读解锁的片段，理解故事后接收寄展，再到收藏册里重温。</p>
              </div>
            </article>
            <div className="preview-explanation">
              <strong>当前交付范围</strong>
              <p>
                {gateway.mode === "mock"
                  ? "这是前端独立交互样例。回应来自预设脚本，不是真实 AI；建议问题可走完整流程。样例剧情和占位美术等待产品、美术确认，进度保存在本浏览器。"
                  : "当前通过服务接口展示进度。自由对话、剧情规则与保存结果取决于后端配置；本地测试章节已走通，正式剧情与真实 AI 仍需团队验收。"}
              </p>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
