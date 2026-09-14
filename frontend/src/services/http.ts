import { z } from "zod";
import {
  GameError,
  healthSchema,
  screeningSchema,
  collectionSchema,
  pageSchema,
  stateSchema,
  storySchema,
  type Gateway,
  type Request,
} from "./contract";

// All model credentials stay on the backend.
export class HttpGateway implements Gateway {
  mode = "http" as const;
  constructor(
    private baseUrl: string,
    private timeout = 15000,
  ) {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    token?: string,
    body?: unknown,
    timeout = this.timeout,
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          signal: abort.signal,
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
      );
      const raw: unknown = await response.json();
      if (!response.ok) {
        const parsed = z
          .object({
            error: z.object({
              code: z.string(),
              message: z.string(),
              trace_id: z.string().nullable().optional(),
            }),
          })
          .safeParse(raw);
        if (parsed.success)
          throw new GameError(
            parsed.data.error.code,
            parsed.data.error.message,
            parsed.data.error.trace_id ?? undefined,
            Number(response.headers.get("Retry-After")) || undefined,
          );
        throw new GameError(
          `HTTP_${response.status}`,
          "服务暂时无法完成请求，请重试。",
        );
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new GameError(
          "INVALID_RESPONSE",
          "返回的数据格式暂不兼容，已有进度已保留。",
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof GameError) throw error;
      throw new GameError(
        abort.signal.aborted ? "NETWORK_TIMEOUT" : "NETWORK_ERROR",
        abort.signal.aborted
          ? "等待回应超时，请重试。"
          : "连接暂时中断，请检查网络后重试。",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  health() {
    return this.request("/health", healthSchema);
  }
  async voice(token: string, text: string, signal: AbortSignal) {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/api/voice`,
      {
        method: "POST",
        signal: AbortSignal.any([signal, AbortSignal.timeout(48000)]),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    );
    if (!response.ok) throw new Error("Voice unavailable");
    return response.blob();
  }
  screening(token: string) {
    return this.request("/api/screening", screeningSchema, token);
  }
  collection(token: string) {
    return this.request("/api/collection", collectionSchema, token);
  }
  story() {
    return this.request("/api/story", storySchema);
  }
  create() {
    return this.request(
      "/api/sessions",
      z.object({ token: z.string(), state: stateSchema }),
      undefined,
      {},
    );
  }
  restore(token: string) {
    return this.request("/api/session", stateSchema, token);
  }
  page(token: string, id: string) {
    return this.request(
      `/api/pages/${encodeURIComponent(id)}`,
      pageSchema,
      token,
    );
  }
  execute(token: string, request: Request) {
    const { request_id, expected_version, action } = request;
    const body = { request_id, expected_version };
    switch (action.type) {
      case "inspect":
        return this.request("/api/inspect", stateSchema, token, {
          ...body,
          target_id: action.target_id,
        });
      case "chat":
        return this.request(
          "/api/chat",
          stateSchema,
          token,
          {
            ...body,
            message: action.message,
          },
          50000,
        );
      case "collect":
        return this.request("/api/collection", stateSchema, token, {
          ...body,
          ...(action.confirm ? { confirm: true } : {}),
        });
      case "screening_start":
        return this.request("/api/screening/start", stateSchema, token, {
          ...body,
          confirm: true,
        });
      case "screening_progress":
        return this.request("/api/screening/progress", stateSchema, token, {
          ...body,
          run_id: action.run_id,
          segment_id: action.segment_id,
          ...(action.advance_mode ? { advance_mode: action.advance_mode } : {}),
        });
      case "screening_resume":
        return this.request("/api/screening/resume", stateSchema, token, {
          ...body,
          run_id: action.run_id,
        });
      case "read":
        return this.request(
          `/api/pages/${encodeURIComponent(action.page_id)}/read`,
          stateSchema,
          token,
          body,
        );
      case "reset":
        return this.request("/api/reset", stateSchema, token, {
          ...body,
          confirm: true,
        });
      case "replay":
        return this.request("/api/replay", stateSchema, token, {
          ...body,
          confirm: true,
        });
    }
  }
}
