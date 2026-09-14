import { useCallback, useRef, useState } from "react";
import { gateway, storagePrefix } from "./services";
import {
  applySnapshot,
  GameError,
  type Action,
  type GameState,
  type Request,
  type StoryMeta,
  type Health,
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
  const getVoice = useCallback((text: string, signal: AbortSignal) => {
    if (!gateway.voice || !token.current)
      return Promise.reject(new Error("Voice unavailable"));
    return gateway.voice(token.current, text, signal);
  }, []);
  const current = useRef<GameState | null>(null);
  const lock = useRef(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [needsResume, setNeedsResume] = useState(false);
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
      const [nextMeta, nextHealth] = await Promise.all([
        gateway.story(),
        gateway.health?.(),
      ]);
      setHealth(nextHealth || null);
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
      setNeedsResume(incoming.phase === "screening");
      setMeta(nextMeta);
      current.current = null;
      apply(incoming);
      const pending = readLocal("pending");
      if (pending && !fresh) {
        try {
          const request = JSON.parse(pending) as Request;
          if (request.session_id && request.session_id !== incoming.session_id)
            throw new Error("stale pending session");
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
      session_id: current.current.session_id,
      request_id: crypto.randomUUID(),
      expected_version: current.current.version,
      action,
    };
    try {
      if (!save("pending", JSON.stringify(request)))
        throw new GameError(
          "STORAGE_UNAVAILABLE",
          "未能保存待确认操作，请恢复浏览器存储后重试。",
        );
      let incoming = await gateway.execute(token.current, request);
      if (incoming.version < current.current.version)
        incoming = await gateway.restore(token.current);
      apply(incoming);
      if (action.type === "chat" && draftRef.current.trim() === action.message)
        setDraft("");
      if (retry && incoming.phase === "screening") setNeedsResume(true);
      else if (["screening_start", "screening_resume"].includes(action.type))
        setNeedsResume(false);
      if (action.type === "reset" || action.type === "replay") {
        setNeedsResume(false);
        setMeta(await gateway.story());
        setDraft("");
        save("page-position", null);
      }
      setFailed(null);
      save("pending", null);
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
      const [incoming, nextMeta, nextHealth] = await Promise.all([
        gateway.restore(token.current),
        gateway.story(),
        gateway.health?.(),
      ]);
      setMeta(nextMeta);
      setHealth(nextHealth || null);
      apply(incoming);
      setNeedsResume(incoming.phase === "screening");
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
  async function enterStory() {
    if (lock.current) return false;
    if (!current.current && !(await start())) return false;
    // Use the restored snapshot immediately; React state may still be rendering.
    if (current.current?.phase === "completed") {
      if (readLocal("pending")) return false;
      return run({ type: "replay", confirm: true });
    }
    return true;
  }
  return {
    enterStory,
    getVoice,
    state,
    meta,
    health,
    needsResume,
    requireResume: () => setNeedsResume(true),
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
    getScreening: () => {
      if (!gateway.screening)
        throw new Error("Screening requires HTTP gateway");
      return gateway.screening(token.current!);
    },
    getCollection: () => {
      if (!gateway.collection)
        throw new Error("Collection requires HTTP gateway");
      return gateway.collection(token.current!);
    },
    getPage: (id: string) => gateway.page(token.current!, id),
    reportError: (err: unknown) => setError(toError(err)),
    clearError: () => setError(null),
  };
}
