import { afterEach, expect, it, vi } from "vitest";
import { HttpGateway } from "./http";
import { initialState } from "../data/chapter";
import { collectionSchema, screeningSchema } from "./contract";
import { frameArt } from "../data/screening-art";
afterEach(() => vi.unstubAllGlobals());
it("sends only formal API fields, with explicit start and collection confirmation", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(initialState("session", 7)))),
    );
  vi.stubGlobal("fetch", fetcher);
  const api = new HttpGateway("https://gushi.example");
  const run = crypto.randomUUID();
  const id = crypto.randomUUID();
  for (const action of [
    { type: "screening_start", confirm: true },
    { type: "screening_progress", run_id: run, segment_id: "FILM001" },
    { type: "screening_resume", run_id: run },
    { type: "collect", confirm: true },
  ] as const) {
    await api.execute("secret", {
      session_id: "session",
      request_id: id,
      expected_version: 6,
      action,
    });
  }
  expect(fetcher.mock.calls.map((x) => x[0])).toEqual([
    "https://gushi.example/api/screening/start",
    "https://gushi.example/api/screening/progress",
    "https://gushi.example/api/screening/resume",
    "https://gushi.example/api/collection",
  ]);
  expect(fetcher.mock.calls.map((x) => JSON.parse(x[1].body))).toEqual([
    { request_id: id, expected_version: 6, confirm: true },
    { request_id: id, expected_version: 6, run_id: run, segment_id: "FILM001" },
    { request_id: id, expected_version: 6, run_id: run },
    { request_id: id, expected_version: 6, confirm: true },
  ]);
  expect(fetcher.mock.calls.every((x) => !x[0].includes("secret"))).toBe(true);
});
it("preserves rate limit cooldown and trace while refusing malformed success responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "稍后重试",
            trace_id: "t-1",
          },
        }),
        { status: 429, headers: { "Retry-After": "12" } },
      ),
    ),
  );
  await expect(
    new HttpGateway("http://test").screening("token"),
  ).rejects.toMatchObject({
    code: "RATE_LIMITED",
    retryAfter: 12,
    traceId: "t-1",
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ phase: "screening", segment: { id: "FILM001" } }),
        ),
      ),
  );
  await expect(
    new HttpGateway("http://test").screening("token"),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});
it("retains all collection text and provenance rather than stripping formal fields", () => {
  const value = collectionSchema.parse({
    story_id: "s",
    item_name: "c",
    summary: "summary",
    full_text: ["first", "last"],
    owner: "苏晚",
    custodian: "看山",
    recipient: "本店",
    story_version: "v1",
    title: "title",
    adaptation_note: "game",
    source: {
      reference: "r",
      author: null,
      original_url: null,
      text_format: "screening_units",
      original_verified: false,
      note: "pending",
    },
    assets: [],
  });
  expect(value.full_text).toEqual(["first", "last"]);
  expect(value.source?.original_verified).toBe(false);
  expect(value.owner).toBe("苏晚");
});
it("maps only the inspected chapter version and never uses later identity art in opening shots", () => {
  expect(frameArt("other", "screening-v4.1", "FILM001").src).toBeNull();
  expect(frameArt("lost-sunshine", "future-version", "FILM020").src).toBeNull();
  expect(frameArt("lost-sunshine", "screening-v4.1", "FILM000").src).toBeNull();
  expect(frameArt("lost-sunshine", "screening-v4.1", "FILM001").kind).toBe(
    "object",
  );
  expect(frameArt("lost-sunshine", "screening-v4.1", "FILM051").src).toContain(
    "ending.webp",
  );
});
