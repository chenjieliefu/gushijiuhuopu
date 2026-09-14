import { HttpGateway } from "./http";
import { MockGateway } from "./mock";
export const gateway =
  import.meta.env.VITE_TRANSPORT === "http"
    ? new HttpGateway(
        import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
      )
    : new MockGateway();
// Separate live credentials/drafts by backend origin; fixtures never overwrite them.
export const storagePrefix = `story-shop:${gateway.mode}:${gateway.mode === "http" ? import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000" : "preview"}:v1`;
