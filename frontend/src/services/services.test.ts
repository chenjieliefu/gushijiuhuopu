import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySnapshot, type Request, type Action } from "./contract";
import { initialState } from "../data/chapter";
import { MockGateway } from "./mock";
import { HttpGateway } from "./http";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  };
}
const command = (version: number, action: Action): Request => ({
  request_id: crypto.randomUUID(),
  expected_version: version,
  action,
});
describe("progress and recovery boundaries", () => {
  let api: MockGateway;
  beforeEach(() => {
    api = new MockGateway(memoryStorage(), 0);
  });
  it("does not collect before facts are confirmed, or confirm an early guess", async () => {
    const { token } = await api.create();
    await expect(
      api.execute(token, command(0, { type: "collect" })),
    ).rejects.toMatchObject({ code: "COLLECTION_LOCKED" });
    const state = await api.execute(
      token,
      command(0, { type: "chat", message: "照片里的女孩就是她自己吗？" }),
    );
    expect(state.disclosed_facts).not.toContain("identity");
    expect(state.can_collect).toBe(false);
  });
  it("replays an identical request once, preserves a failed action, and rejects reused IDs", async () => {
    const { token } = await api.create();
    const request = command(0, { type: "chat", message: "照片里有什么？" });
    api.failNext = true;
    await expect(api.execute(token, request)).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    });
    expect((await api.restore(token)).version).toBe(0);
    const state = await api.execute(token, request);
    expect(await api.execute(token, request)).toEqual(state);
    expect((await api.restore(token)).messages).toHaveLength(3);
    await expect(
      api.execute(token, {
        ...request,
        action: { type: "chat", message: "不同的问题" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("reads separately from disclosure, collects once, restores, and keeps reset versions monotonic", async () => {
    const { token } = await api.create();
    let state = await api.restore(token);
    for (const message of [
      "照片里有什么？",
      "她后来去哪里寻找答案？",
      "书店里的男生为什么认识她？",
      "晴天对她有什么意义？",
    ])
      state = await api.execute(
        token,
        command(state.version, { type: "chat", message }),
      );
    expect(state.can_collect).toBe(true);
    const beforeRead = [...state.disclosed_facts];
    await api.page(token, "sunny_day");
    expect((await api.restore(token)).read_pages).toEqual([]);
    state = await api.execute(
      token,
      command(state.version, { type: "read", page_id: "sunny_day" }),
    );
    expect(state.disclosed_facts).toEqual(beforeRead);
    const collectionRequest = command(state.version, { type: "collect" });
    state = await api.execute(token, collectionRequest);
    expect(state.status).toBe("completed");
    expect(await api.execute(token, collectionRequest)).toEqual(state);
    expect(await api.restore(token)).toEqual(state);
    const reset = await api.execute(
      token,
      command(state.version, { type: "reset", confirm: true }),
    );
    expect(reset.version).toBe(state.version + 1);
    expect(reset.collection).toBeNull();
    const oldReplay = await api.execute(token, collectionRequest);
    expect(applySnapshot(reset, oldReplay)).toEqual(reset);
  });
  it("does not apply old snapshots or snapshots from another session", () => {
    const current = initialState("one", 9);
    expect(applySnapshot(current, initialState("one", 8))).toBe(current);
    expect(applySnapshot(current, initialState("two", 20))).toBe(current);
    expect(applySnapshot(current, initialState("one", 10)).version).toBe(10);
  });
  it("keeps unknown medical details and unrelated messages out of the fact set", async () => {
    const { token } = await api.create();
    const state = await api.execute(
      token,
      command(0, { type: "chat", message: "她得的是什么病？" }),
    );
    expect(state.disclosed_facts).toEqual([]);
    expect(state.messages.at(-1)?.text).toContain("不了解");
    await expect(api.page(token, "sunny_day")).rejects.toMatchObject({
      code: "PAGE_LOCKED",
    });
    await expect(
      api.execute(
        token,
        command(0, { type: "inspect", target_id: "camera_front" }),
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

describe("HTTP adapter contract (mocked fetch, not live integration)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  it("sends only allowed fields and reuses the full command for a retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(initialState("test", 1)), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const api = new HttpGateway("http://example.test/");
    const request = command(0, { type: "inspect", target_id: "camera_front" });
    await api.execute("private-test-token", request);
    // Each fetch response body is consumed once.
    fetcher.mockResolvedValue(
      new Response(JSON.stringify(initialState("test", 1)), { status: 200 }),
    );
    await api.execute("private-test-token", request);
    expect(fetcher.mock.calls[0][0]).toBe("http://example.test/api/inspect");
    const sent = fetcher.mock.calls[0][1];
    expect(JSON.parse(sent.body)).toEqual({
      request_id: request.request_id,
      expected_version: 0,
      target_id: "camera_front",
    });
    expect(sent.body).toBe(fetcher.mock.calls[1][1].body);
    expect(sent.headers.Authorization).toBe("Bearer private-test-token");
  });
  it("does not mask malformed data as a valid state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ status: "completed" })),
        ),
    );
    await expect(
      new HttpGateway("http://example.test").restore("token"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("retains structured version errors and trace IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "VERSION_CONFLICT",
              message: "进度已更新",
              trace_id: "safe-trace",
            },
          }),
          { status: 409 },
        ),
      ),
    );
    await expect(
      new HttpGateway("http://example.test").restore("token"),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      traceId: "safe-trace",
    });
  });
});
