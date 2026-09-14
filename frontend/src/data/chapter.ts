import type { GameState, StoryMeta, StoryPage } from "../services/contract";

// Frontend-only fixture, based on the supplied brief. Product has not approved
// the final story config. This file is NEVER consulted by HttpGateway.
export const chapter: StoryMeta = {
  id: "sunny-day-preview",
  version: "frontend-sample-v1",
  is_test_fixture: true,
  title: "遗失的晴天",
  item_name: "老式相机",
  inspection_targets: [
    { id: "camera_front", label: "相机机身" },
    { id: "photo_front", label: "照片正面" },
    { id: "photo_back", label: "照片背面" },
  ],
};
export const inspections: Record<string, string> = {
  camera_front: "木质机身磨得温润发亮，镜头蒙着一层薄灰。它像是被搁置了很久。",
  photo_front:
    "照片里，一个扎马尾、穿白衬衫的女孩站在老街的梧桐树下。她笑得很明亮。",
  photo_back:
    "最后一张照片背面写着：“希望我的女孩，永远拥有晴天。”没有署名，也没有日期。",
};
export const facts: Record<string, string> = {
  origin: "苏晚在旧物回收站买下相机，冲洗了里面遗留的胶卷。",
  mystery: "照片里的女孩与苏晚长得一模一样，她却不记得这些照片。",
  bookshop: "苏晚循着照片里的老街，走进一家书店；店里的男生认出了她。",
  identity:
    "照片中的女孩就是十年前的苏晚。一场重病让她失去了那段青春的记忆，也忘记了曾经喜欢的人。",
  meaning: "相机让苏晚与过去的自己、曾经喜欢的人重逢，重新感受到生活的温柔。",
};
export const pages: Record<string, StoryPage> = {
  old_street: {
    id: "old_street",
    title: "风铃响起的地方",
    text: "苏晚按照片中的地址，找到了那条老街。梧桐树依旧茂盛，晚风缓缓吹过。\n\n老街尽头有一家小书店。推门时，风铃轻轻作响。柜台后的男生抬起头，看见她的瞬间，怔了一下。\n\n“你终于来了。”",
  },
  sunny_day: {
    id: "sunny_day",
    title: "遗失的晴天",
    text: "照片里的女孩，就是十年前的苏晚。那场重病带走了她一整段青春的记忆，也让她忘记了曾经喜欢的人。\n\n男生一直记着她，也一直在等她。相机里的照片，让苏晚重新认识了曾经明媚、热烈的自己。\n\n傍晚的落日铺满江面。苏晚举起相机，对着落日，对着眼前的人，轻轻按下快门。\n\n遗失的晴天，终于找回来了。",
  },
};
export const source = {
  author: null,
  url: null,
  adaptation:
    "“看山受苏晚委托，将相机送来寄展”为游戏新增连接情节。相机的所有权仍属于苏晚。",
};
export const collectionSummary =
  "一台老式相机，让苏晚找回遗失的青春片段，与曾经喜欢的人重逢，也重新看见生活里的晴天。";
export function initialState(sessionId: string, version = 0): GameState {
  return {
    session_id: sessionId,
    story_id: chapter.id,
    story_version: chapter.version,
    is_test_fixture: true,
    version,
    status: "active",
    clues: [],
    disclosed_facts: [],
    unlocked_pages: [],
    read_pages: [],
    messages: [
      {
        role: "assistant",
        text: "你好，店主。我叫看山，受苏晚所托，带这台相机来寄展。它看起来很普通，却帮她找回了一段遗失的时光。你想先看看吗？",
      },
    ],
    summary: "",
    expression: "neutral",
    suggested_questions: [
      "这台相机是怎么来的？",
      "照片里有什么？",
      "为什么想把它寄展在这里？",
    ],
    can_collect: false,
    collection: null,
  };
}
