import { z } from "zod";

// Formal contract v1; optional additions retain compatibility with the exploration fixture.
export const sourceSchema = z.object({
  reference: z.string(),
  author: z.string().nullable(),
  original_url: z.string().nullable(),
  text_format: z.enum(["paragraphs", "screening_units"]),
  original_verified: z.boolean(),
  note: z.string(),
});
export const collectionSchema = z.object({
  story_id: z.string(),
  item_name: z.string(),
  summary: z.string(),
  story_version: z.string().optional(),
  title: z.string().optional(),
  owner: z.string().optional(),
  custodian: z.string().optional(),
  recipient: z.string().optional(),
  adaptation_note: z.string().optional(),
  full_text: z.array(z.string()).optional(),
  source: sourceSchema.optional(),
  assets: z
    .array(
      z.object({
        id: z.string(),
        path: z.string(),
        status: z.enum(["pending", "approved"]),
      }),
    )
    .optional(),
});
export const playbackSchema = z.object({
  run_id: z.string().uuid(),
  next_segment: z.number().int().nonnegative(),
  segment_started_at: z.number(),
  completed: z.boolean(),
});
export const phaseSchema = z.enum([
  "exploration",
  "before_screening",
  "screening",
  "after_screening",
  "completed",
]);
export const screeningSchema = z.object({
  story_id: z.string(),
  story_version: z.string(),
  version: z.number().int().nonnegative(),
  phase: phaseSchema,
  playback: playbackSchema.nullable(),
  total_segments: z.number().int().positive(),
  segment: z
    .object({
      id: z.string(),
      text: z.string(),
      duration_ms: z.number().int().positive().max(120000),
      visual: z.string(),
      asset_id: z.string().nullable(),
    })
    .nullable(),
});
export const healthSchema = z.object({
  status: z.literal("ok"),
  ai_mode: z.enum(["mock", "scripted", "custom"]),
  flow: z.enum(["exploration", "screening"]),
  original_verified: z.boolean(),
});
export type ScreeningView = z.infer<typeof screeningSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export type Health = z.infer<typeof healthSchema>;
export const stateSchema = z.object({
  session_id: z.string(),
  story_id: z.string(),
  story_version: z.string(),
  is_test_fixture: z.boolean(),
  version: z.number().int().nonnegative(),
  status: z.enum(["active", "completed"]),
  phase: phaseSchema.optional(),
  playback: playbackSchema.nullable().optional(),
  messages: z.array(
    z.object({ role: z.enum(["assistant", "user"]), text: z.string() }),
  ),
  clues: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      source: z.literal("inspection"),
    }),
  ),
  disclosed_facts: z.array(z.string()),
  summary: z.string(),
  unlocked_pages: z.array(z.string()),
  read_pages: z.array(z.string()),
  expression: z.enum(["neutral", "thoughtful", "warm"]),
  suggested_questions: z.array(z.string()),
  can_collect: z.boolean(),
  collection: collectionSchema.nullable(),
});
export const pageSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
});
export const storySchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  item_name: z.string(),
  is_test_fixture: z.boolean(),
  flow: z.enum(["exploration", "screening"]).optional(),
  owner: z.string().optional(),
  custodian: z.string().optional(),
  recipient: z.string().optional(),
  source: sourceSchema.optional(),
  inspection_targets: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type GameState = z.infer<typeof stateSchema>;
export type StoryPage = z.infer<typeof pageSchema>;
export type StoryMeta = z.infer<typeof storySchema>;
export type Action =
  | { type: "inspect"; target_id: string }
  | { type: "chat"; message: string }
  | { type: "read"; page_id: string }
  | { type: "collect"; confirm?: true }
  | { type: "screening_start"; confirm: true }
  | { type: "screening_progress"; run_id: string; segment_id: string }
  | { type: "screening_resume"; run_id: string }
  | { type: "reset"; confirm: true };
export type Request = {
  session_id?: string;
  request_id: string;
  expected_version: number;
  action: Action;
};
export interface Gateway {
  mode: "mock" | "http";
  health?(): Promise<Health>;
  screening?(token: string): Promise<ScreeningView>;
  collection?(token: string): Promise<Collection>;
  story(): Promise<StoryMeta>;
  create(): Promise<{ token: string; state: GameState }>;
  restore(token: string): Promise<GameState>;
  execute(token: string, request: Request): Promise<GameState>;
  page(token: string, id: string): Promise<StoryPage>;
}
export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
    public traceId?: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function applySnapshot(
  current: GameState | null,
  incoming: GameState,
): GameState {
  const checked = stateSchema.parse(incoming);
  if (
    current &&
    (checked.session_id !== current.session_id ||
      checked.version < current.version)
  )
    return current;
  return checked;
}
