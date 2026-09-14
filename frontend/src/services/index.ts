import { HttpGateway } from "./http";
import { MockGateway } from "./mock";
import type { Gateway } from "./contract";
export const gateway: Gateway =
  import.meta.env.VITE_TRANSPORT === "http"
    ? new HttpGateway(
        import.meta.env.VITE_API_BASE_URL || window.location.origin,
      )
    : new MockGateway();
// Separate live credentials/drafts by backend origin; fixtures never overwrite them.
export const storagePrefix = `story-shop:${gateway.mode}:${gateway.mode === "http" ? import.meta.env.VITE_API_BASE_URL || window.location.origin : "preview"}:v1`;
