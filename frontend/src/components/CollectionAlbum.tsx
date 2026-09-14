import { useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import type { Collection } from "../services/contract";
import { screeningArt } from "../data/screening-art";
import { Dialog } from "./Dialog";
import "./collection-album.css";

export function CollectionAlbum({
  collection,
  loading,
  error,
  onClose,
}: {
  collection: Collection | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  // Opening the album always starts at its illustrated catalogue.
  const [view, setView] = useState<"catalogue" | "detail" | "story" | "source">(
    "catalogue",
  );
  const [page, setPage] = useState(0);
  const paragraphs = collection?.full_text || [];
  const pages = Math.ceil(paragraphs.length / 2);
  const title = collection?.title || "遗失的晴天";
  const item = collection?.item_name || "苏晚的相机";
  return (
    <Dialog
      title="旧物收藏册"
      eyebrow="故事旧货铺 · 一物一记"
      wide
      onClose={onClose}
    >
      <div className="collection-album">
        <div className="album-ribbon" aria-hidden="true" />
        {loading && !collection && (
          <p className="album-status" role="status">
            正在翻开收藏册…
          </p>
        )}
        {error && (
          <p className="album-status" role="alert">
            {error}
          </p>
        )}
        {collection && (
          <>
            <div className="album-spread" key={view}>
              <section className="album-leaf album-left" aria-label="收藏图鉴">
                <span className="album-kicker">藏品 · 001</span>
                {view === "catalogue" ? (
                  <>
                    <h3>
                      留住一件旧物，
                      <br />
                      也留住它的故事。
                    </h3>
                    <button
                      className="album-entry"
                      onClick={() => setView("detail")}
                      aria-label="翻开相机介绍"
                    >
                      <span className="album-photo">
                        <img
                          src={screeningArt.camera}
                          alt="收藏册中的老式相机图案"
                        />
                      </span>
                      <span className="album-entry-name">{item}</span>
                      <span className="album-entry-hint">
                        点击相机，翻开这一页 <ArrowRight size={14} />
                      </span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="album-photo album-keepsake">
                      <img src={screeningArt.camera} alt="苏晚寄展的老式相机" />
                    </div>
                    <h3>{item}</h3>
                    <p className="album-handwriting">
                      希望我的女孩，
                      <br />
                      永远拥有晴天。
                    </p>
                  </>
                )}
                <span className="album-folio">01 · 旧物</span>
              </section>
              <section
                className="album-leaf album-right"
                aria-label={view === "catalogue" ? "收藏册扉页" : "相机的故事"}
              >
                {view === "catalogue" ? (
                  <div className="album-frontispiece">
                    <BookOpen size={30} strokeWidth={1} />
                    <p className="album-kicker">旧物入店 · 故事入册</p>
                    <h3>我的收藏</h3>
                    <span className="album-rule" />
                    <p>
                      这里记下每一件
                      <br />
                      留在店里的旧物。
                    </p>
                    <small>已收录 1 件旧物</small>
                  </div>
                ) : view === "detail" ? (
                  <div className="album-detail">
                    <span className="album-kicker">一台相机 · 一段时光</span>
                    <h3>{title}</h3>
                    <p className="album-description">{collection.summary}</p>
                    <dl className="album-provenance">
                      {collection.owner && (
                        <>
                          <dt>旧物主人</dt>
                          <dd>{collection.owner}</dd>
                        </>
                      )}
                      {collection.custodian && (
                        <>
                          <dt>带来的人</dt>
                          <dd>{collection.custodian}</dd>
                        </>
                      )}
                      <dt>收藏方式</dt>
                      <dd>寄展于故事旧货铺</dd>
                    </dl>
                    {!!pages && (
                      <button
                        className="album-text-button"
                        onClick={() => {
                          setPage(0);
                          setView("story");
                        }}
                      >
                        翻阅完整故事 <ArrowRight size={15} />
                      </button>
                    )}
                    {collection.source && (
                      <button
                        className="album-source-link"
                        onClick={() => setView("source")}
                      >
                        故事来源
                      </button>
                    )}
                  </div>
                ) : view === "story" ? (
                  <div className="album-reading">
                    <span className="album-kicker">
                      {title} · {page + 1} / {pages}
                    </span>
                    <article aria-label="收藏故事全文" key={page}>
                      {paragraphs
                        .slice(page * 2, page * 2 + 2)
                        .map((text, i) => (
                          <p key={i}>{text}</p>
                        ))}
                    </article>
                    <nav aria-label="故事翻页" className="album-page-controls">
                      <button
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ArrowLeft size={14} /> 上一页
                      </button>
                      <button
                        disabled={page === pages - 1}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        下一页 <ArrowRight size={14} />
                      </button>
                    </nav>
                  </div>
                ) : (
                  <div className="album-source">
                    <span className="album-kicker">故事背后的记录</span>
                    <h3>故事来源</h3>
                    <p>{collection.adaptation_note}</p>
                    <p>原作者：{collection.source?.author || "待核实"}</p>
                    <p>{collection.source?.note}</p>
                    {collection.source?.original_url &&
                      /^https?:\/\//.test(collection.source.original_url) && (
                        <a
                          href={collection.source.original_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看原文来源 ↗
                        </a>
                      )}
                  </div>
                )}
                <span className="album-folio">
                  {view === "catalogue" ? "02 · 扉页" : "02 · 故事"}
                </span>
              </section>
            </div>
            <footer className="album-footer">
              {view !== "catalogue" ? (
                <button
                  onClick={() =>
                    setView(view === "detail" ? "catalogue" : "detail")
                  }
                >
                  <ArrowLeft size={14} />
                  {view === "detail" ? "返回收藏图鉴" : "返回相机介绍"}
                </button>
              ) : (
                <span>从相机开始，翻开一段晴天。</span>
              )}
              <span>故事旧货铺</span>
            </footer>
          </>
        )}
      </div>
    </Dialog>
  );
}
