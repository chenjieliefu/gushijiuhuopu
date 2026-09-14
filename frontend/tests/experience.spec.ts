import { expect, test, type Page } from "@playwright/test";

async function enter(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "推门营业" }).click();
  await expect(page.getByRole("textbox", { name: "向看山提问" })).toBeVisible();
}
async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: "向看山提问" }).fill(text);
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByRole("textbox", { name: "向看山提问" })).toHaveValue(
    "",
  );
}
test("complete visit: inspect, drafts, page reading, collection and reset", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await page.screenshot({
    path: testInfo.outputPath("welcome.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "推门营业" }).click();
  const input = page.getByRole("textbox", { name: "向看山提问" });
  await expect(input).toBeVisible();
  await expect(page.getByText("有一段回忆，可以翻开了")).toHaveCount(0);
  await input.fill("这句话先留着");
  await page.getByRole("button", { name: "检查相机", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("已记入线索手记")).toBeVisible();
  await dialog.getByRole("button", { name: "照片正面" }).click();
  await expect(dialog.getByText("已记入线索手记")).toBeVisible();
  await dialog.getByRole("button", { name: "下一张照片" }).click();
  await expect(dialog.getByText("2 / 2")).toBeVisible();
  await dialog.getByRole("button", { name: "翻到背面" }).click();
  await expect(dialog.getByText("已记入线索手记")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("inspect.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "返回店铺", exact: true }).click();
  await expect(input).toHaveValue("这句话先留着");
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await expect(input).toHaveValue("这句话先留着");
  for (const question of [
    "照片里有什么？",
    "她后来去哪里寻找答案？",
    "书店里的男生为什么认识她？",
    "晴天对她有什么意义？",
  ])
    await ask(page, question);
  await page.getByRole("button", { name: /故事片段.*段尚未阅读/ }).click();
  await dialog.getByRole("button", { name: /遗失的晴天/ }).click();
  await expect(dialog.getByText("01 / 04")).toBeVisible();
  for (let i = 0; i < 3; i++)
    await dialog.getByRole("button", { name: "继续读" }).click();
  await page.screenshot({
    path: testInfo.outputPath("story.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "读完了，回到店铺" }).click();
  await expect(dialog).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("game.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "为这段故事留个位置" }).click();
  await dialog.getByRole("button", { name: "再聊一会儿" }).click();
  await expect(input).toBeVisible();
  await page.getByRole("button", { name: "为这段故事留个位置" }).click();
  await dialog.getByRole("button", { name: "确认接收寄展" }).dblclick();
  await dialog.getByRole("button", { name: "跳过动效，打开收藏册" }).click();
  await expect(dialog.getByText("已接收寄展", { exact: true })).toBeVisible();
  await expect(dialog.getByText("原作者：待产品补充")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("collection.png"),
    fullPage: true,
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "返回店铺", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await expect(
    page.getByRole("heading", { name: "本次来访已结束" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看已寄展的相机" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await dialog.getByRole("button", { name: "保留当前进度" }).click();
  await expect(input).toHaveCount(0);
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await dialog.getByRole("button", { name: "确认重新开始" }).click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /已记录.*处细节/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("failure preserves input across refresh and retry does not duplicate a message", async ({
  page,
}) => {
  await enter(page);
  await page.getByRole("button", { name: "演示：模拟一次失败" }).click();
  await page.getByRole("textbox").fill("这台相机是怎么来的？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await expect(page.getByRole("alert")).toContainText("这次回应没能送达");
  await expect(page.getByRole("textbox")).toHaveValue("这台相机是怎么来的？");
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await expect(page.getByRole("alert")).toContainText("上次操作的结果尚待确认");
  await page.getByRole("button", { name: "重试这次操作" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("");
  await expect(
    page.getByRole("log").getByText("这台相机是怎么来的？", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("suggestions clear the sent draft, dialog traps focus, and unknown facts do not advance", async ({
  page,
}) => {
  await enter(page);
  await page
    .getByRole("button", { name: "这台相机是怎么来的？", exact: true })
    .click();
  await expect(page.getByRole("textbox")).toHaveValue("");
  await ask(page, "她得的是什么病？");
  await expect(page.getByRole("log")).toContainText("苏晚没有告诉我这些细节");
  await expect(
    page.getByRole("button", { name: "为这段故事留个位置" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "玩法与说明" }).click();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "玩法与说明" })).toBeFocused();
});

test("typing during a reply is retained and empty submissions stay disabled", async ({
  page,
}) => {
  await enter(page);
  const input = page.getByRole("textbox");
  await input.fill("   ");
  await expect(page.getByRole("button", { name: "发送问题" })).toBeDisabled();
  await input.fill("照片里有什么？");
  await page.getByRole("button", { name: "发送问题" }).click();
  await input.fill("我还有另一个问题");
  await expect(page.getByRole("log")).toContainText("而苏晚完全不记得这些照片");
  await expect(input).toHaveValue("我还有另一个问题");
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await expect(input).toHaveValue("我还有另一个问题");
});
