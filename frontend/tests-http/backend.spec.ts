import { expect, test } from "@playwright/test";

test("real HTTP backend: session, inspect, chat, page, collect, reload and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  const responses: { path: string; status: number }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/"))
      responses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "推门营业" }).click();
  await expect(
    page.getByRole("heading", { name: /联调测试章节/ }),
  ).toBeVisible();
  const input = page.getByRole("textbox", { name: "向看山提问" });
  const dialog = page.getByRole("dialog");
  async function inspect(label: string) {
    await page.getByRole("button", { name: "检查相机", exact: true }).click();
    if (label === "检查照片背面") {
      await expect(dialog.getByText("已记入线索手记")).toBeVisible();
      await dialog.getByRole("button", { name: label }).click();
    }
    await expect(dialog.getByText("已记入线索手记")).toBeVisible();
    await dialog.getByRole("button", { name: "返回店铺", exact: true }).click();
  }
  async function ask(text: string) {
    await input.fill(text);
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(input).toHaveValue("");
  }
  await inspect("检查相机正面");
  await ask("这是什么物件？");
  await expect(page.getByRole("log")).toContainText("测试事实 A");
  await inspect("检查照片背面");
  await ask("为什么要寄展？");
  await expect(page.getByRole("log")).toContainText("测试事实 B");
  await page.getByRole("button", { name: /有一段回忆/ }).click();
  await expect(dialog).toContainText("这是预先配置的测试故事页");
  await dialog.getByRole("button", { name: "读完了，回到店铺" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "为这段故事留个位置" }).click();
  await dialog.getByRole("button", { name: "确认接收寄展" }).dblclick();
  await dialog.getByRole("button", { name: "跳过动效，打开收藏册" }).click();
  await expect(dialog).toContainText("联调测试收藏");
  await dialog.getByRole("button", { name: "返回店铺", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "继续上次的故事" }).click();
  await expect(
    page.getByRole("heading", { name: "本次来访已结束" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await dialog.getByRole("button", { name: "确认重新开始" }).click();
  await expect(input).toBeVisible();
  await expect(page.getByRole("log")).not.toContainText("测试事实 A");
  expect(responses.filter((response) => response.status >= 400)).toEqual([]);
  for (const path of [
    "/api/story",
    "/api/sessions",
    "/api/session",
    "/api/inspect",
    "/api/chat",
    "/api/pages/demo_page",
    "/api/pages/demo_page/read",
    "/api/collection",
    "/api/reset",
  ])
    expect(responses.some((response) => response.path === path)).toBe(true);
  expect(
    responses.filter((response) => response.path === "/api/collection"),
  ).toHaveLength(1);
  expect(errors).toEqual([]);
});
