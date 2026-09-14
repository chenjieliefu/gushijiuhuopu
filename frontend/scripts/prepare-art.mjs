// Reproducible web-delivery compression. Original artwork remains untouched.
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL(
  "../../materials/遗失的晴天/遗憾的晴天场景图片/",
  import.meta.url,
);
const output = new URL("../public/assets/sunny/", import.meta.url);
const entries = {
  shop: "214610_279",
  visitor: "215120_299",
  camera: "215135_305",
  street: "215138_306",
  school: "215140_307",
  photo: "215143_308",
  note: "215145_309",
  reunion: "215034_292",
  bookshop: "214822_287",
  sunset: "214826_288",
  ending: "215105_293",
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const manifest = [];
  for (const [name, suffix] of Object.entries(entries)) {
    const filename = `微信图片_20260914${suffix}_144.png`;
    const bytes = await readFile(new URL(filename, base));
    const data = await page.evaluate(
      async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        const scale = Math.min(1, 1600 / img.width);
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/webp", 0.88);
      },
      "data:image/png;base64," + bytes.toString("base64"),
    );
    const webp = Buffer.from(data.split(",")[1], "base64");
    await writeFile(new URL(`${name}.webp`, output), webp);
    manifest.push({
      id: name,
      source: filename,
      source_sha256: createHash("sha256").update(bytes).digest("hex"),
      path: `/assets/sunny/${name}.webp`,
      bytes: webp.length,
      status: "frontend-proposal",
    });
  }
  await writeFile(
    new URL("manifest.json", output),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `Prepared ${manifest.length} web assets, ${(manifest.reduce((n, x) => n + x.bytes, 0) / 1024 / 1024).toFixed(2)} MiB`,
  );
} finally {
  await browser.close();
}
