import { z } from "zod";
import {
  GameError,
  pageSchema,
  stateSchema,
  storySchema,
  type Gateway,
  type Request,
} from "./contract";

// Prepared against the checked-in contract. Live backend integration is deferred.
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
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeout);
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
        return this.request("/api/chat", stateSchema, token, {
          ...body,
          message: action.message,
        });
      case "collect":
        return this.request("/api/collection", stateSchema, token, body);
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
    }
  }
}
