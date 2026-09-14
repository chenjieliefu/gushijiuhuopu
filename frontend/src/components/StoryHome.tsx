import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Feather,
  LoaderCircle,
} from "lucide-react";
import type { useGame } from "../useGame";
import { screeningArt } from "../data/screening-art";
import { CollectionAlbum } from "./CollectionAlbum";
import { SoundControls } from "./SoundControls";
import "./story-home.css";

type Game = ReturnType<typeof useGame>;
export function StoryHome({
  game,
  view,
  onSelect,
  onHome,
  onEnter,
}: {
  game: Game;
  view: "home" | "stories";
  onSelect: () => void;
  onHome: () => void;
  onEnter: () => void;
}) {
  const [album, setAlbum] = useState(false);
  const { state, busy, error } = game;
  const restored = useRef(false);
  useEffect(() => {
    if (!restored.current && game.hasSave && !state) {
      restored.current = true;
      void game.start();
    }
  }, [game, state]);
  const completed = state?.phase === "completed";
  async function enter() {
    if (busy) return;
    if (await game.enterStory()) onEnter();
  }
  return (
    <div className={`story-home ${view === "stories" ? "is-selecting" : ""}`}>
      <img
        className="story-home-background"
        src={screeningArt.shop}
        alt="午后阳光里的旧货铺"
      />
      <div className="story-home-shade" />
      <header className="story-home-header">
        <button
          className="story-home-brand"
          onClick={onHome}
          aria-label="返回主页"
        >
          <Feather size={22} />
          <span>
            故事旧货铺<small>THE STORY SHOP</small>
          </span>
        </button>
        <nav aria-label="主页导航">
          {state?.collection && (
            <button onClick={() => setAlbum(true)}>
              <BookOpen size={16} /> 收藏册
            </button>
          )}
          <SoundControls />
        </nav>
      </header>
      {view === "home" ? (
        <main className="story-home-main">
          <div className="story-home-copy">
            <p className="story-home-eyebrow">一间小店 · 收留时光</p>
            <h1>
              每一件旧物，
              <br />
              都有话想说。
            </h1>
            <p className="story-home-intro">
              推开门，做一会儿店主。
              <br />
              听一段往事，给故事留一个位置。
            </p>
            <button className="story-home-primary" onClick={onSelect}>
              选择故事 <ArrowRight size={18} />
            </button>
            <p className="story-home-note">故事由你选择，时间由你掌握。</p>
          </div>
          <img
            className="story-home-visitor"
            src={screeningArt.visitor}
            alt="在旧货铺等候的看山"
          />
        </main>
      ) : (
        <main className="story-select-main">
          <button className="story-select-back" onClick={onHome}>
            <ArrowLeft size={15} /> 返回主页
          </button>
          <p className="story-home-eyebrow">旧物来信 / 故事选择</p>
          <h1>今天，听哪一段故事？</h1>
          <p className="story-select-caption">从一件旧物开始，走进它的往事。</p>
          <article className="story-select-card">
            <div className="story-select-cover">
              <img src={screeningArt.street} alt="遗失的晴天：阳光下的老街" />
              <span>第一章</span>
            </div>
            <div className="story-select-description">
              <span className="story-select-status">
                {completed
                  ? "已完成 · 已收录收藏册"
                  : state?.collection
                    ? "重新体验中 · 收藏已保留"
                    : state || game.hasSave
                      ? "有一段故事，等你继续"
                      : "可游玩"}
              </span>
              <h2>遗失的晴天</h2>
              <p>
                一台旧相机，一叠没有日期的照片。
                <br />
                沿着光的痕迹，找回一段遗失的时光。
              </p>
              <span className="story-select-tag">老式相机 · 记忆与重逢</span>
              <button
                className="story-home-primary"
                disabled={busy}
                onClick={() => void enter()}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="spin" size={16} /> 正在打开故事…
                  </>
                ) : (
                  <>
                    {completed
                      ? "重新体验"
                      : state || game.hasSave
                        ? "继续故事"
                        : "进入故事"}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
              {completed && (
                <p className="story-home-note">
                  从开场重新体验，收藏册中的旧物会为你保留。
                </p>
              )}
              {error && (
                <div className="story-select-error" role="alert">
                  <p>{error.message}</p>
                  {game.failed && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        void game.retry()?.then((ok) => {
                          if (ok) onEnter();
                        });
                      }}
                    >
                      重试上次操作
                    </button>
                  )}
                  {["INVALID_SESSION", "AUTH_REQUIRED"].includes(
                    error.code,
                  ) && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        void game.start(true).then((ok) => {
                          if (ok) onEnter();
                        });
                      }}
                    >
                      开始新的体验
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
          <p className="story-select-footnote">本次体验收录《遗失的晴天》。</p>
        </main>
      )}
      {album && (
        <CollectionAlbum
          collection={state?.collection || null}
          loading={false}
          error=""
          onClose={() => setAlbum(false)}
        />
      )}
    </div>
  );
}
