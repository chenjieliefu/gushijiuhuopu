import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
const story = JSON.parse(
  readFileSync(
    new URL("../../stories/lost-sunshine.json", import.meta.url),
    "utf8",
  ),
);
const evidence =
  process.env.FRONTEND_EVIDENCE_DIR || "test-results/screening-evidence";
mkdirSync(evidence, { recursive: true });
test("formal chapter: all 51 real-time captions, independent consignment, collection and reset", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const observed: string[] = [];
  const progress: string[] = [];
  const failures: string[] = [];
  let collects = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/api/screening/progress"))
      progress.push(r.postDataJSON().segment_id);
    if (r.url().endsWith("/api/collection") && r.method() === "POST") {
      collects++;
      expect(r.postDataJSON().confirm).toBe(true);
    }
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400)
      failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.goto("/");
  await page.getByRole("button", { name: "推门营业" }).click();
  await expect(
    page.getByRole("heading", { name: "遗失的晴天。" }),
  ).toBeVisible();
  await expect(
    page.getByText("固定问答体验 · 自由 AI 待接入", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/${info.project.name}-counter.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "检查相机", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已经擦拭过");
  await page.getByRole("button", { name: "返回店铺", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "向看山提问" });
  await draft.fill("这是寄展，还是想卖给我？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(draft).toHaveValue("");
  await page.getByRole("button", { name: "听听故事", exact: true }).click();
  const caption = page.getByTestId("film-caption");
  for (const [i, segment] of story.screening.segments.entries()) {
    await expect(caption).toHaveAttribute("data-segment", segment.id, {
      timeout: 25000,
    });
    await expect(caption.locator("p")).toHaveText(segment.text);
    observed.push(segment.id);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button")).toHaveCount(0);
    if (i === 0 || i === 21 || i === 48)
      await page.screenshot({
        path: `${evidence}/${info.project.name}-${segment.id}.png`,
        fullPage: true,
      });
  }
  await expect(
    page.getByRole("button", { name: "谈谈寄展", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(progress).toEqual(
    story.screening.segments.map((s: { id: string }) => s.id),
  );
  expect(observed).toHaveLength(51);
  await draft.fill("我愿意收");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(draft).toHaveValue("");
  expect(collects).toBe(0);
  await page.getByRole("button", { name: "谈谈寄展", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("苏晚");
  await page.getByRole("button", { name: "再想一想", exact: true }).click();
  expect(collects).toBe(0);
  await page.getByRole("button", { name: "谈谈寄展", exact: true }).click();
  await page
    .getByRole("button", { name: "确认接收寄展", exact: true })
    .dblclick();
  await expect(
    page.getByRole("heading", { name: "故事有了归处。" }),
  ).toBeVisible();
  expect(collects).toBe(1);
  await page.getByRole("button", { name: "翻开收藏册", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "收藏故事全文" }).locator("p"),
  ).toHaveCount(51);
  await expect(
    page.getByRole("article", { name: "收藏故事全文" }).locator("p").last(),
  ).toHaveText(story.full_text.at(-1));
  await page.screenshot({
    path: `${evidence}/${info.project.name}-collection.png`,
  });
  await page.getByRole("button", { name: "返回店铺", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await expect(
    page.getByRole("heading", { name: "故事有了归处。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await page.getByRole("button", { name: "确认重新开始", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "听听故事", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test("response loss + reload replays pending UUID before resume, without skipping captions", async ({
  page,
}) => {
  let dropped = false;
  let firstBody: unknown;
  const requests: unknown[] = [];
  await page.route("**/api/screening/progress", async (route) => {
    requests.push(route.request().postDataJSON());
    if (!dropped) {
      dropped = true;
      firstBody = route.request().postDataJSON();
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "推门营业" }).click();
  await page.getByRole("button", { name: "听听故事", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试这次操作", exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await expect(page.getByRole("region", { name: "恢复放映" })).toBeVisible();
  await page.getByRole("button", { name: "重试这次操作", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续放映", exact: true }),
  ).toBeEnabled();
  expect(requests[1]).toEqual(firstBody);
  await page.getByRole("button", { name: "继续放映", exact: true }).click();
  await expect(page.getByTestId("film-caption")).toHaveAttribute(
    "data-segment",
    "FILM002",
  );
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await page.getByRole("button", { name: "继续放映", exact: true }).click();
  await expect(page.getByTestId("film-caption")).toHaveAttribute(
    "data-segment",
    "FILM002",
  );
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("opening choices, rate cooldown and stopped asset load do not advance the story", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "推门营业" }).click();
  await expect(
    page.getByRole("button", { name: "你和苏晚是什么关系？" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${evidence}/${info.project.name}-counter-final.png`,
    fullPage: true,
  });
  let reject = true;
  let attempts = 0;
  await page.route("**/api/chat", async (route) => {
    attempts++;
    if (reject) {
      reject = false;
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "2" },
        body: JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "请稍后重试",
            trace_id: "test-rate-limit",
          },
        }),
      });
    } else await route.continue();
  });
  await page
    .getByRole("textbox", { name: "向看山提问" })
    .fill("你和苏晚是什么关系？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByRole("button", { name: /秒后可重试/ })).toBeDisabled();
  expect(attempts).toBe(1);
  await expect(
    page.getByRole("button", { name: "重试这次操作", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "重试这次操作", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "向看山提问" })).toHaveValue(
    "",
  );
  expect(attempts).toBe(2);
  let starts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/screening/start")) starts++;
  });
  await page.route("**/assets/sunny/ending.webp", (route) => route.abort());
  await page.getByRole("button", { name: "听听故事", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("放映画面还没准备好");
  expect(starts).toBe(0);
  await page.unroute("**/assets/sunny/ending.webp");
  await page.getByRole("button", { name: "听听故事", exact: true }).click();
  await expect(page.getByTestId("film-caption")).toHaveAttribute(
    "data-segment",
    "FILM001",
  );
  expect(starts).toBe(1);
});

test("a second tab invalidates the old player; sync requires resume rather than replaying old progress", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "推门营业" }).click();
  await page.getByRole("button", { name: "听听故事", exact: true }).click();
  await expect(page.getByTestId("film-caption")).toHaveAttribute(
    "data-segment",
    "FILM001",
  );
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "继续上次的故事" }).click();
  await other.getByRole("button", { name: "继续放映", exact: true }).click();
  await expect(other.getByTestId("film-caption")).toHaveAttribute(
    "data-segment",
    "FILM001",
  );
  await expect(
    page.getByRole("button", { name: "同步已保存进度", exact: true }),
  ).toBeVisible({ timeout: 25000 });
  await other.close();
  await page
    .getByRole("button", { name: "同步已保存进度", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "继续放映", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "继续放映", exact: true }).click();
  await expect(page.getByTestId("film-caption")).toHaveAttribute(
    "data-segment",
    /FILM00[12]/,
  );
});
