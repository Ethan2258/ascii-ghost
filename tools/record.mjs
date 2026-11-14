// Record the seamless loop to PNG frames: node tools/record.mjs <url> <outDir> [theme] [w,h,frames,fps]
// Needs playwright-core and a Chromium (npx playwright-core install chromium).
// Encode afterwards with tools/encode.py.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [url = "http://localhost:8899/", out = "frames", theme = "dark", spec = "1320,450,240,24"] = process.argv.slice(2);
const [w, h, frames] = spec.split(",").map(Number);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await page.goto(`${url}?record=${spec}&theme=${theme}`);
await page.waitForFunction(() => window.__sky && document.fonts.status === "loaded");
for (let i = 0; i < frames; i++) {
  const data = await page.evaluate((i) => window.__sky.frame(i), i);
  writeFileSync(join(out, `f${String(i).padStart(4, "0")}.png`), Buffer.from(data.split(",")[1], "base64"));
}
await browser.close();
console.log(`${frames} frames -> ${out}`);
