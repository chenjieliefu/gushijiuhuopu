// Local visual proposal for this exact content revision, never a source of story facts.
// Backend asset_id remains untouched; unknown chapters/revisions use a neutral paper frame.
const asset = (id: string) => `/assets/sunny/${id}.webp`;
export const screeningArt = {
  shop: asset("shop"),
  visitor: asset("visitor"),
  camera: asset("camera"),
  street: asset("street"),
  photo: asset("photo"),
  note: asset("note"),
};
export type FrameArt = {
  src: string | null;
  kind: "object" | "photo" | "scene" | "paper";
  position?: string;
};
export function frameArt(
  storyId: string,
  version: string,
  segmentId: string,
): FrameArt {
  if (
    storyId !== "lost-sunshine" ||
    version !== "screening-v4.1" ||
    !/^FILM\d{3}$/.test(segmentId)
  )
    return { src: null, kind: "paper" };
  const n = Number(segmentId.slice(4));
  if (n < 1 || n > 51) return { src: null, kind: "paper" };
  if (n <= 8) return { src: asset("camera"), kind: "object" };
  if (n === 13 || n === 14) return { src: asset("note"), kind: "photo" };
  if (n <= 18)
    return { src: asset(n === 10 ? "school" : "street"), kind: "photo" };
  if (n <= 23) return { src: asset("reunion"), kind: "scene" };
  if (n === 24 || n === 25) return { src: asset("photo"), kind: "photo" };
  if (n <= 35) return { src: asset("bookshop"), kind: "scene" };
  if (n <= 40) return { src: asset("street"), kind: "photo" };
  if (n <= 47) return { src: asset("bookshop"), kind: "scene" };
  return { src: asset(n >= 49 ? "ending" : "sunset"), kind: "scene" };
}
const cache = new Map<string, Promise<void>>();
export function loadArtwork(src: string): Promise<void> {
  const previous = cache.get(src);
  if (previous) return previous;
  const promise = new Promise<void>((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(
      () => reject(new Error("画面加载超时")),
      15000,
    );
    image.onload = () => {
      clearTimeout(timer);
      image.decode().then(resolve, reject);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("画面未能加载"));
    };
    image.src = src;
  }).catch((error) => {
    cache.delete(src);
    throw error;
  });
  cache.set(src, promise);
  return promise;
}
export function preloadFilm(storyId: string, version: string) {
  const urls = new Set(
    Array.from(
      { length: 51 },
      (_, i) =>
        frameArt(storyId, version, `FILM${String(i + 1).padStart(3, "0")}`).src,
    ).filter((x): x is string => !!x),
  );
  return Promise.all([...urls].map(loadArtwork));
}
