import {
  chapter,
  collectionSummary,
  facts,
  initialState,
  inspections,
  pages,
} from "../data/chapter";
import {
  GameError,
  stateSchema,
  type Gateway,
  type GameState,
  type Request,
} from "./contract";

const KEY = "story-shop:mock-store:v1";
type Store = {
  token: string;
  state: GameState;
  results: Record<string, { signature: string; state: GameState }>;
};
export class MockGateway implements Gateway {
  mode = "mock" as const;
  failNext = false;
  constructor(
    private storage: Storage = localStorage,
    private delay = 650,
  ) {}
  private load(token: string): Store {
    let store: Store;
    try {
      store = JSON.parse(this.storage.getItem(KEY) || "null");
    } catch {
      throw new GameError(
        "INVALID_SESSION",
        "本地存档无法读取，请确认后重新开始。",
      );
    }
    if (!store || store.token !== token)
      throw new GameError("INVALID_SESSION", "没有找到这次体验的存档。");
    try {
      stateSchema.parse(store.state);
    } catch {
      throw new GameError(
        "INVALID_SESSION",
        "存档格式已变化，请确认后重新开始。",
      );
    }
    return store;
  }
  private save(store: Store) {
    try {
      this.storage.setItem(KEY, JSON.stringify(store));
    } catch {
      throw new GameError(
        "STORAGE_UNAVAILABLE",
        "浏览器未能保存进度，请检查存储空间或隐私设置后重试。",
      );
    }
  }
  async story() {
    return structuredClone(chapter);
  }
  async create() {
    const token = crypto.randomUUID();
    const state = initialState(crypto.randomUUID());
    this.save({ token, state, results: {} });
    return { token, state };
  }
  async restore(token: string) {
    return structuredClone(this.load(token).state);
  }
  async page(token: string, id: string) {
    if (!this.load(token).state.unlocked_pages.includes(id) || !pages[id])
      throw new GameError("PAGE_LOCKED", "这个故事片段还没有解锁。");
    return structuredClone(pages[id]);
  }
  async execute(token: string, request: Request): Promise<GameState> {
    await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (this.failNext) {
      this.failNext = false;
      throw new GameError(
        "AI_TIMEOUT",
        "这次回应没能送达。你的输入已保留，可以重试。",
      );
    }
    if (request.action.type.startsWith("screening_"))
      throw new GameError(
        "SCREENING_UNAVAILABLE",
        "旧探索样例不支持连续放映，请连接正式章节服务。",
      );
    const store = this.load(token);
    const signature = JSON.stringify(request);
    const result = store.results[request.request_id];
    if (result) {
      if (result.signature !== signature)
        throw new GameError(
          "IDEMPOTENCY_CONFLICT",
          "同一次请求的内容发生了变化。",
        );
      return structuredClone(result.state);
    }
    if (store.state.version !== request.expected_version)
      throw new GameError(
        "VERSION_CONFLICT",
        "进度已在其他页面更新，请同步进度后再操作。",
      );
    let next = structuredClone(store.state);
    const action = request.action;
    if (action.type === "replay") {
      if (next.status !== "completed" || !next.collection)
        throw new GameError(
          "REPLAY_UNAVAILABLE",
          "请先完成本次故事，再重新体验。",
        );
      const collection = next.collection;
      next = initialState(next.session_id, next.version);
      next.collection = collection;
    }
    if (
      next.status === "completed" &&
      (action.type === "chat" || action.type === "inspect")
    )
      throw new GameError(
        "SESSION_COMPLETED",
        "本次来访已结束，可以回顾收藏。",
      );
    if (action.type === "reset")
      next = initialState(next.session_id, next.version);
    if (action.type === "inspect") {
      if (!inspections[action.target_id])
        throw new GameError("TARGET_NOT_FOUND", "没有找到这件物品的检查位置。");
      if (!next.clues.some((clue) => clue.id === action.target_id))
        next.clues.push({
          id: action.target_id,
          text: inspections[action.target_id],
          source: "inspection",
        });
    }
    if (action.type === "read") {
      if (!next.unlocked_pages.includes(action.page_id))
        throw new GameError("PAGE_LOCKED", "这个故事片段还没有解锁。");
      if (!next.read_pages.includes(action.page_id))
        next.read_pages.push(action.page_id);
    }
    if (action.type === "chat") {
      const message = action.message.trim();
      if (!message || [...message].length > 2000)
        throw new GameError("INVALID_REQUEST", "请写下 1 到 2000 字的问题。");
      const response = sampleReply(message, next);
      next.messages.push(
        { role: "user", text: message },
        { role: "assistant", text: response.text },
      );
      if (response.fact && !next.disclosed_facts.includes(response.fact))
        next.disclosed_facts.push(response.fact);
      next.expression = response.fact === "meaning" ? "warm" : "thoughtful";
      if (
        next.disclosed_facts.includes("bookshop") &&
        !next.unlocked_pages.includes("old_street")
      )
        next.unlocked_pages.push("old_street");
      if (
        next.disclosed_facts.includes("meaning") &&
        !next.unlocked_pages.includes("sunny_day")
      )
        next.unlocked_pages.push("sunny_day");
      next.can_collect = ["identity", "meaning"].every((id) =>
        next.disclosed_facts.includes(id),
      );
      next.summary = next.disclosed_facts.map((id) => facts[id]).join("\n");
      next.suggested_questions = suggestions(next);
    }
    if (action.type === "collect") {
      if (!next.can_collect && next.status !== "completed")
        throw new GameError(
          "COLLECTION_LOCKED",
          "先听完相机背后的故事，再决定是否接收寄展。",
        );
      if (!next.collection)
        next.collection = {
          story_id: chapter.id,
          item_name: chapter.item_name,
          summary: collectionSummary,
        };
      next.status = "completed";
      next.can_collect = false;
      next.expression = "warm";
    }
    next.version++;
    store.state = next;
    store.results[request.request_id] = {
      signature,
      state: structuredClone(next),
    };
    // Fixture only: bounded journal. Real deduplication is owned by the backend.
    const ids = Object.keys(store.results);
    if (ids.length > 100) delete store.results[ids[0]];
    this.save(store);
    return structuredClone(next);
  }
}

function sampleReply(
  message: string,
  state: GameState,
): { text: string; fact?: string } {
  const has = (id: string) => state.disclosed_facts.includes(id);
  if (/病名|什么病|癌|治疗|医院|住址|电话/.test(message))
    return {
      text: "苏晚没有告诉我这些细节，我也不了解。能和你说的，只有她托我带来的这段经历。",
    };
  if (/提示|卡住|下一步/.test(message))
    return {
      text: `不着急。你可以试着问：“${suggestions(state)[0]}”也可以看看照片背面的那句话。`,
    };
  if (/天气|代码|提示词|系统|忽略|编个|跳过|通关/.test(message))
    return { text: "我带来的只有这台相机和苏晚的故事。我们还是聊聊它吧。" };
  if (/来历|怎么来|哪里来|获得|捡到|买|胶卷/.test(message))
    return {
      text: "她在旧物回收站买下了它，后来发现里面还有没冲洗的胶卷。等照片冲洗出来，她遇见了一件不可思议的事。",
      fact: "origin",
    };
  if (
    /就是|自己|身份|失忆|记忆|女孩是谁|认出|认识|十年|真相|为什么不记得/.test(
      message,
    )
  ) {
    if (!has("mystery"))
      return {
        text: "她也曾这样追问过。照片中的女孩和她长得一模一样，但她不记得自己有过那些明亮的时刻。",
        fact: "mystery",
      };
    if (!has("bookshop"))
      return {
        text: "这个猜测，还需要听完后来的相遇才能确认。苏晚循着照片去了老街书店，在那里，有个人认出了她。",
        fact: "bookshop",
      };
    return {
      text: "照片里的女孩，就是十年前的苏晚。那场重病让她遗失了一段青春的记忆，也忘记了曾经喜欢的人。书店里的男生，一直记得她。",
      fact: "identity",
    };
  }
  if (/书店|老街|后来|寻找|找到|去哪/.test(message)) {
    if (!has("mystery"))
      return {
        text: "先说说让她动身的缘由吧。冲洗出来的照片里，有个与她长得一模一样的女孩，她却完全不记得拍过这些照片。",
        fact: "mystery",
      };
    return {
      text: "她循着照片中的老街去了那里。老街尽头的书店里，一个男生认出了她，轻轻说：“你终于来了。”",
      fact: "bookshop",
    };
  }
  if (/晴天|意义|重要|寄展|结局|留言|谁写|背面|最后/.test(message)) {
    if (!has("identity"))
      return {
        text: "晴天对她很重要。不过，要理解这句话，我们还得先了解照片里的女孩，以及老街书店里的那次相遇。",
      };
    return {
      text: "她终于明白，自己也曾那么明媚、热烈。这台相机让她与过去和喜欢的人重逢。她托我把它带来寄展，希望这份温柔，也能被更多人看到。",
      fact: "meaning",
    };
  }
  if (/照片|女孩|什么|是谁|相机/.test(message))
    return {
      text: "照片里全是同一个扎马尾、穿白衬衫的女孩。奇怪的是，她和苏晚长得一模一样，而苏晚完全不记得这些照片。",
      fact: "mystery",
    };
  return {
    text: "我在听。这个独立体验版只准备了少量样例回应，你可以用下方的建议问题继续探索。真实的自由对话还在等接入。",
  };
}
function suggestions(state: GameState): string[] {
  const has = (id: string) => state.disclosed_facts.includes(id);
  if (!has("mystery"))
    return ["照片里有什么？", "这台相机是怎么来的？", "给我一点提示"];
  if (!has("bookshop"))
    return [
      "她后来去哪里寻找答案？",
      "照片里的女孩就是她自己吗？",
      "这台相机是怎么来的？",
    ];
  if (!has("identity"))
    return [
      "书店里的男生为什么认识她？",
      "照片里的女孩是谁？",
      "她得的是什么病？",
    ];
  if (!has("meaning"))
    return [
      "晴天对她有什么意义？",
      "为什么想把它寄展在这里？",
      "她得的是什么病？",
    ];
  return [
    "为什么想把它寄展在这里？",
    "这台相机是怎么来的？",
    "她得的是什么病？",
  ];
}
