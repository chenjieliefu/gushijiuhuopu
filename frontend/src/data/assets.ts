// Set a URL after the art team delivers that slot. null keeps the SVG study.
// Use paths under public/assets, e.g. '/assets/kanshan-neutral.webp'.
export const artAssets: {
  shop: string | null;
  camera: string | null;
  kanshan: Record<"neutral" | "thoughtful" | "warm", string | null>;
  story: Record<"street" | "sunny", string | null>;
  photo: Record<"street" | "sunny" | "back", string | null>;
} = {
  shop: null,
  camera: null,
  kanshan: { neutral: null, thoughtful: null, warm: null },
  story: { street: null, sunny: null },
  photo: { street: null, sunny: null, back: null },
};
