import { z } from "zod";

// Mirrors app/models.py at origin/feat/backend-integration (64fb739).
export const stateSchema = z.object({
  session_id: z.string(),
  story_id: z.string(),
  story_version: z.string(),
  is_test_fixture: z.boolean(),
  version: z.number().int().nonnegative(),
  status: z.enum(["active", "completed"]),
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
  collection: z
    .object({
      story_id: z.string(),
      item_name: z.string(),
      summary: z.string(),
    })
    .nullable(),
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
  inspection_targets: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type GameState = z.infer<typeof stateSchema>;
export type StoryPage = z.infer<typeof pageSchema>;
export type StoryMeta = z.infer<typeof storySchema>;
export type Action =
  | { type: "inspect"; target_id: string }
  | { type: "chat"; message: string }
  | { type: "read"; page_id: string }
  | { type: "collect" }
  | { type: "reset"; confirm: true };
export type Request = {
  request_id: string;
  expected_version: number;
  action: Action;
};
export interface Gateway {
  mode: "mock" | "http";
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
