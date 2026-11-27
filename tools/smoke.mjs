// Smoke test in a real browser: node tools/smoke.mjs [url]
// Serve the repository first (python -m http.server 8899). Needs playwright-core and a
// Chromium; CHROME=/path/to/chrome picks the binary (CI uses the runner's Google Chrome).
//
// Checks the live page (draws, no console errors, theme switch, routing), the embedding
// API that other pages vendor (mount with fps / maxDpr / leftTree, destroy) and that the
// record mode stays a deterministic loop.
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://127.0.0.1:8899/";
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };

async function open(path, viewport, deviceScaleFactor = 1) {
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL(path, url).href);
  return { page, errors };
}

/** Share of canvas pixels that differ from the top-left one: 0 means nothing was drawn. */
const inked = (page, selector) => page.evaluate((sel) => {
  const c = document.querySelector(sel);
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) n++;
  return n / (d.length / 4);
}, selector);

try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const at = `${viewport.width}px`;
    const { page, errors } = await open("./", viewport);
    await page.waitForFunction(() => window.ghostRealm && document.fonts.status === "loaded");
    await page.waitForTimeout(1200);
    check((await inked(page, "#sky")) > 0.02, `${at}: the scene is drawn`);

    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click("nav button");
    await page.waitForTimeout(700);
    const after = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      checked: document.querySelector("nav button").getAttribute("aria-checked"),
    }));
    check(after.theme !== before && after.checked === String(after.theme === "light"), `${at}: theme switch ${before} -> ${after.theme}`);

    await page.click('nav a[href="#/projects"]');
    await page.waitForTimeout(300);
    const routed = await page.evaluate(() => ({
      active: document.querySelector("[data-view][data-active]")?.dataset.view,
      title: document.title,
    }));
    check(routed.active === "projects" && routed.title.endsWith("projects"), `${at}: #/projects shows the project list`);

    const stats = await page.evaluate(() => window.ghostRealm.stats());
    check(Number.isFinite(stats.median), `${at}: frames are being stepped (median ${stats.median?.toFixed(2)} ms)`);
    check(errors.length === 0, `${at}: no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await page.close();
  }

  // The embedding API, as a page that vendors src/ uses it: a canvas of its own size on a 2x
  // screen, capped at 30 fps and 1x, without the left tree; destroy() must stop it. (The page is
  // opened in record mode only so that its own scene stays out of the way.)
  {
    const { page, errors } = await open("./?record=1,1,1,1", { width: 800, height: 600 }, 2);
    const result = await page.evaluate(async () => {
      const { mount } = await import("./src/scene.js");
      const canvas = Object.assign(document.createElement("canvas"), { id: "embed" });
      canvas.style.cssText = "position:fixed;left:40px;top:40px;width:480px;height:270px;display:block";
      document.body.append(canvas);
      const sky = mount(canvas, { theme: "light", leftTree: false, fps: 30, maxDpr: () => 1 });
      await new Promise((r) => setTimeout(r, 1500));
      const size = [canvas.width, canvas.height];
      const stepped = sky.stats().median !== undefined;
      sky.destroy();
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#123456";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise((r) => setTimeout(r, 300));
      const px = ctx.getImageData(10, 10, 1, 1).data;
      return { size, stepped, stillAfterDestroy: px[0] === 0x12 && px[1] === 0x34 && px[2] === 0x56 };
    });
    check(result.size[0] === 480 && result.size[1] === 270, `embed: maxDpr 1 lays out at 1x (${result.size.join("x")})`);
    check(result.stepped, "embed: the mounted scene runs");
    check(result.stillAfterDestroy, "embed: nothing is drawn after destroy()");
    check(errors.length === 0, `embed: no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await page.close();
  }

  // fps: at 2x every drawn frame sets the 2x transform exactly once, so counting those calls
  // counts frames.
  {
    const { page, errors } = await open("./?record=1,1,1,1", { width: 800, height: 600 }, 2);
    const fps = await page.evaluate(async () => {
      const { mount } = await import("./src/scene.js");
      const canvas = document.createElement("canvas");
      canvas.style.cssText = "position:fixed;left:0;top:0;width:320px;height:180px;display:block";
      document.body.append(canvas);
      const ctx = canvas.getContext("2d");
      let draws = 0;
      const setTransform = ctx.setTransform;
      ctx.setTransform = function (...a) { if (a[0] === 2) draws++; return setTransform.apply(this, a); };
      const sky = mount(canvas, { fps: 20 });
      await new Promise((r) => setTimeout(r, 300));
      draws = 0;
      await new Promise((r) => setTimeout(r, 1000));
      sky.destroy();
      return draws;
    });
    check(fps > 0 && fps <= 24, `embed: fps 20 draws at most ~20 frames a second (${fps})`);
    check(errors.length === 0, `embed: no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await page.close();
  }

  // Record mode: tools/record.mjs takes frames 0..n-1 in order. They must differ from one another,
  // and the loop must close: frame 0 rendered again after the last frame stays far closer to the
  // first frame 0 than two neighbouring frames are to each other (afterimages make it not exact).
  {
    const n = 24;
    const { page, errors } = await open(`./?record=320,120,${n},24&theme=dark`, { width: 320, height: 120 });
    await page.waitForFunction(() => window.__sky && document.fonts.status === "loaded");
    const r = await page.evaluate(async (n) => {
      const pixels = (src) => new Promise((done) => {
        const img = new Image();
        img.onload = () => {
          const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d");
          ctx.drawImage(img, 0, 0);
          done(ctx.getImageData(0, 0, img.width, img.height).data);
        };
        img.src = src;
      });
      const distance = (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i] - b[i]); return sum / (a.length * 0.75); };
      const frames = [];
      for (let i = 0; i < n; i++) frames.push(window.__sky.frame(i));
      const [first, second, again] = await Promise.all([pixels(frames[0]), pixels(frames[1]), pixels(window.__sky.frame(0))]);
      return {
        png: frames.every((f) => f.startsWith("data:image/png")),
        distinct: new Set(frames).size,
        loop: distance(first, again),
        step: distance(first, second),
      };
    }, n);
    check(r.png, "record: frames are PNG data URLs");
    check(r.distinct === n, `record: the ${n} frames all differ (${r.distinct} distinct)`);
    check(r.loop < r.step * 0.25, `record: the loop closes (frame 0 again differs by ${r.loop.toFixed(2)}, neighbours by ${r.step.toFixed(2)})`);
    check(errors.length === 0, `record: no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
