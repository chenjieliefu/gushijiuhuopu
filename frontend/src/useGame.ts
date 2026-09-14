import { useRef, useState } from "react";
import { gateway, storagePrefix } from "./services";
import {
  applySnapshot,
  GameError,
  type Action,
  type GameState,
  type Request,
  type StoryMeta,
} from "./services/contract";

const readLocal = (key: string) => {
  try {
    return localStorage.getItem(`${storagePrefix}:${key}`);
  } catch {
    return null;
  }
};
const toError = (error: unknown) =>
  error instanceof GameError
    ? error
    : new GameError("UNEXPECTED", "这一步暂时没有完成，请重试。");
export function useGame() {
  const token = useRef(readLocal("token"));
  const current = useRef<GameState | null>(null);
  const lock = useRef(false);
  const [state, setState] = useState<GameState | null>(null);
  const [meta, setMeta] = useState<StoryMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);
  const [failed, setFailed] = useState<Request | null>(null);
  const [draft, setDraftState] = useState(readLocal("draft") || "");
  const draftRef = useRef(draft);
  const [saveNotice, setSaveNotice] = useState("");
  const [lastAction, setLastAction] = useState<Action["type"] | null>(null);
  const save = (key: string, value: string | null) => {
    try {
      value === null
        ? localStorage.removeItem(`${storagePrefix}:${key}`)
        : localStorage.setItem(`${storagePrefix}:${key}`, value);
      return true;
    } catch {
      setSaveNotice("浏览器未能保存记录，刷新后可能无法继续。");
      return false;
    }
  };
  const setDraft = (value: string) => {
    draftRef.current = value;
    setDraftState(value);
    save("draft", value);
  };
  const apply = (incoming: GameState) => {
    const checked = applySnapshot(current.current, incoming);
    current.current = checked;
    setState(checked);
  };
  async function start(fresh = false) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const nextMeta = await gateway.story();
      let incoming: GameState;
      if (!fresh && token.current)
        incoming = await gateway.restore(token.current);
      else {
        const created = await gateway.create();
        if (!save("token", created.token))
          throw new GameError(
            "STORAGE_UNAVAILABLE",
            "无法保存继续体验所需的凭据，请检查浏览器存储后重试。",
          );
        token.current = created.token;
        incoming = created.state;
        save("pending", null);
        save("page-position", null);
        setFailed(null);
        setDraft("");
      }
      setMeta(nextMeta);
      current.current = null;
      apply(incoming);
      const pending = readLocal("pending");
      if (pending && !fresh) {
        try {
          const request = JSON.parse(pending) as Request;
          setFailed(request);
          setError(
            new GameError(
              "INTERRUPTED",
              "上次操作的结果尚待确认，可重试确认结果。",
            ),
          );
        } catch {
          save("pending", null);
        }
      }
      return true;
    } catch (err) {
      setError(toError(err));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function run(action: Action, retry?: Request): Promise<boolean> {
    if (
      lock.current ||
      !token.current ||
      !current.current ||
      (failed && !retry)
    )
      return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setLastAction(action.type);
    const request = retry ?? {
      request_id: crypto.randomUUID(),
      expected_version: current.current.version,
      action,
    };
    save("pending", JSON.stringify(request));
    try {
      let incoming = await gateway.execute(token.current, request);
      if (incoming.version < current.current.version)
        incoming = await gateway.restore(token.current);
      apply(incoming);
      setFailed(null);
      save("pending", null);
      if (action.type === "chat" && draftRef.current.trim() === action.message)
        setDraft("");
      if (action.type === "reset") {
        setDraft("");
        save("page-position", null);
      }
      return true;
    } catch (err) {
      setFailed(request);
      setError(toError(err));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
      setLastAction(null);
    }
  }
  async function sync() {
    if (lock.current || !token.current) return;
    lock.current = true;
    setBusy(true);
    try {
      apply(await gateway.restore(token.current));
      setFailed(null);
      save("pending", null);
      setError(null);
    } catch (err) {
      setError(toError(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reset() {
    // Explicitly confirmed by the reset dialog. Clear a failed command before
    // issuing a fresh reset against the latest state.
    if (
      !state ||
      ["INVALID_SESSION", "AUTH_REQUIRED"].includes(error?.code || "")
    )
      return start(true);
    if (failed) {
      await sync();
      return false;
    }
    return run({ type: "reset", confirm: true });
  }
  return {
    state,
    meta,
    busy,
    error,
    failed,
    draft,
    setDraft,
    saveNotice,
    lastAction,
    hasSave: !!token.current,
    start,
    run,
    reset,
    sync,
    retry: () => failed && run(failed.action, failed),
    getPage: (id: string) => gateway.page(token.current!, id),
    reportError: (err: unknown) => setError(toError(err)),
    clearError: () => setError(null),
  };
}
