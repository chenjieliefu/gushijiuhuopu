// Start the formal chapter locally without a model key; never touches deployment config.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = fileURLToPath(new URL("../", import.meta.url));
const apiPort = process.env.STORY_API_PORT || "18001";
const webPort = process.env.STORY_WEB_PORT || "5180";
for (const value of [apiPort, webPort])
  if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error("Use a port between 1024 and 65535");
const origin = `http://127.0.0.1:${webPort}`;
const backend = spawn(
  "uv",
  [
    "run",
    "--locked",
    "uvicorn",
    "app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    apiPort,
  ],
  {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      DATABASE_PATH:
        process.env.STORY_LOCAL_DATABASE || "data/frontend-screening.sqlite3",
      STORY_PATH: "stories/lost-sunshine.json",
      AI_MODE: "scripted",
      CORS_ORIGINS: origin,
    },
  },
);
const web = spawn("npm", ["run", "dev", "--", "--port", webPort], {
  cwd: frontend,
  stdio: "inherit",
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    VITE_TRANSPORT: "http",
    VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}`,
  },
});
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of [backend, web]) {
    if (!child.pid) continue;
    try {
      process.platform === "win32"
        ? child.kill("SIGTERM")
        : process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
  process.exitCode = code;
}
for (const child of [backend, web]) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
console.log(`Formal chapter: ${origin} (scripted replies; no real AI)`);
