// ASCII ghost realm: a graveyard horizon in low fog, and wraiths drifting over it.
// Everything moving is glyphs on one canvas grid. The wraiths are density fields with their
// faces cut out, lit by a soft glow that follows their shape and leaving fading afterimages.
// Static layers (sky, graves, vignette) are painted once per theme and size.
//
//   mount(canvas, { theme: "dark" | "light" })                    live page
//   mount(canvas, { record: { width, height, frames, fps } })     deterministic seamless loop,
//                                                                 drive it with frame(i)

import { TAU, clamp, lerp, smoothstep, mixRgb, rgba, rng, hash3, valueNoise, fbm, lineGlyph } from "./util.js";
import { wraithAt, WRAITH } from "./wraith.js";

const CHARS = " .:-=+*#%@~"; // 1..9 is the density ramp, 10 is fog
const GL = 32, FL = 16; // ghost / fog colour levels

const THEMES = {
  dark: {
    page: [10, 10, 12], edge: [0, 0, 0, 0.82], sky: [40, 41, 47],
    embedPage: [13, 17, 23], fog: [124, 126, 134], embedGround: [120, 122, 132], ground: [6, 6, 8], groundEdge: [92, 94, 102],
    ghostLo: [70, 72, 82], ghostHi: [232, 236, 242], glow: [150, 160, 182], glowA: 0.42, blend: "lighter",
    ripple: [196, 198, 206], flash: [190, 198, 222],
  },
  light: {
    page: [226, 225, 222], edge: [70, 70, 74, 0.38], sky: [200, 200, 204],
    embedPage: [255, 255, 255], fog: [104, 104, 110], embedGround: [128, 128, 136], ground: [62, 62, 66], groundEdge: [96, 96, 102],
    ghostLo: [150, 150, 156], ghostHi: [18, 18, 22], glow: [70, 70, 78], glowA: 0.3, blend: "source-over",
    ripple: [60, 60, 66], flash: [255, 255, 255],
  },
};
for (const t of Object.values(THEMES)) {
  t.css = [];
  for (let i = 0; i < GL; i++) {
    const k = i / (GL - 1);
    t.css.push(rgba(mixRgb(t.ghostLo, t.ghostHi, Math.pow(k, 0.75)), 0.18 + 0.82 * k));
  }
  for (let i = 0; i < FL; i++) t.css.push(rgba(t.fog, 0.04 + (i / (FL - 1)) * 0.5));
}

export function mount(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const rec = opts.record || null;
  // embed: a recording on GitHub's own README background (#0d1117 / #ffffff), so it melts into the page
  const embed = !!(rec && rec.embed);
  const loopT = rec ? rec.frames / rec.fps : 0;
  const seed = rec ? 2258 : (Math.random() * 1e6) | 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  let P = THEMES[opts.theme === "light" ? "light" : "dark"];

  let W = 0, H = 0, S = 0, dpr = 1, cw = 9, ch = 12, cols = 0, rows = 0, horizon = 0;
  let dens, trail, ground, hillRow, avoid, gcols = 0, grows = 0, fogGrid;
  let opB, opK, opC, counts, starts, order;
  let ghosts = [];
  const ripples = [];
  let avoidRects = [];
  const ptr = { x: -1e5, y: -1e5, lastMove: -1e9, light: 0 };
  let time = 0, flash = 0, nextFlash = 14;
  let caches = {};
  const glowC = document.createElement("canvas");
  const gctx = glowC.getContext("2d");
  let glowImg = null;

  // --------------------------------------------------------------- layout

  function layout(w, h, ratio) {
    W = w; H = h; dpr = ratio; S = Math.min(W, H);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    cw = embed ? 13 : clamp(Math.round(W / 150), 7, 11);
    ch = Math.round(cw * 1.35);
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);
    horizon = H * (H > W ? 0.9 : 0.86);
    const n = cols * rows;
    dens = new Float32Array(n); trail = new Float32Array(n); avoid = new Float32Array(n);
    opB = new Uint8Array(n); opK = new Uint32Array(n); opC = new Uint8Array(n); order = new Uint32Array(n);
    counts = new Uint32Array(GL + FL); starts = new Uint32Array(GL + FL);
    gcols = Math.ceil(cols / 2) + 2; grows = Math.ceil(rows / 2) + 2;
    fogGrid = new Float32Array(gcols * grows);
    glowC.width = cols; glowC.height = rows;
    glowImg = gctx.createImageData(cols, rows);
    buildGround();
    caches = {};

    if (rec) ghosts = recordCast();
    else if (!ghosts.length) {
      for (let i = 0; i < 2; i++) { const g = makeGhost(i ? "wisp" : "wraith", Math.random); g.fadeIn = 2.5; ghosts.push(g); }
    }
    measure();
  }

  /** Graves, crosses and a dead tree on a low rise, drawn once and read back per cell. */
  function buildGround() {
    const m = document.createElement("canvas");
    m.width = cols; m.height = rows;
    const g = m.getContext("2d");
    g.scale(1 / cw, 1 / ch);
    g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineCap = "round";
    const r = rng(seed + 5);
    const hill = (x) => horizon + Math.sin(x / W * 5.1 + 1.3) * S * 0.018 + Math.sin(x / W * 13.7) * S * 0.008;
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, hill(x));
    g.lineTo(W, H); g.closePath(); g.fill();
    const u = S * (embed ? 0.13 : 0.075);
    let x = W * 0.03;
    while (x < W * 0.84) {
      const kind = r(), hgt = u * (0.7 + r() * 0.9), wid = hgt * (0.5 + r() * 0.25), lean = (r() - 0.5) * 0.25;
      g.save(); g.translate(x, hill(x) + u * 0.15); g.rotate(lean);
      if (kind < 0.55) {
        g.beginPath(); g.moveTo(-wid / 2, 0); g.lineTo(-wid / 2, -hgt + wid / 2);
        g.arc(0, -hgt + wid / 2, wid / 2, Math.PI, 0); g.lineTo(wid / 2, 0); g.closePath(); g.fill();
      } else if (kind < 0.85) {
        const t = wid * 0.28;
        g.fillRect(-t / 2, -hgt * 1.15, t, hgt * 1.15);
        g.fillRect(-wid * 0.45, -hgt * 0.85, wid * 0.9, t);
      } else {
        g.fillRect(-wid * 0.7, -hgt * 0.35, wid * 1.4, hgt * 0.35);
      }
      g.restore();
      x += u * (1.3 + r() * 2.4);
    }
    const tx = W * (H > W ? 0.86 : 0.9);
    const branch = (x0, y0, ang, len, wdt, depth) => {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      g.lineWidth = Math.max(wdt, embed ? cw * 0.9 : 0);
      g.beginPath(); g.moveTo(x0, y0);
      g.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * len * 0.3, (y0 + y1) / 2, x1, y1); g.stroke();
      if (depth <= 0 || wdt < cw * 0.5) return;
      const n2 = 2 + (r() < 0.35 ? 1 : 0);
      for (let i = 0; i < n2; i++) branch(x1, y1, ang + (r() - 0.5) * 1.3 - 0.08, len * (0.62 + r() * 0.15), wdt * 0.62, depth - 1);
    };
    branch(tx, hill(tx) + 4, -Math.PI / 2 - 0.12, S * 0.22, S * 0.035, 5);
    const a = g.getImageData(0, 0, cols, rows).data;
    ground = new Float32Array(cols * rows);
    for (let k = 0; k < ground.length; k++) ground[k] = a[k * 4 + 3] / 255;
    hillRow = new Int16Array(cols);
    for (let i = 0; i < cols; i++) hillRow[i] = Math.floor(hill((i + 0.5) * cw) / ch);
  }

  function font() { return `600 ${Math.round(ch * 0.8)}px "Geist Mono", ui-monospace, Consolas, Menlo, monospace`; }

  /** Sky, graves and the vignette never move: paint them once per theme. */
  function cache(pal) {
    const key = pal === THEMES.light ? "light" : "dark";
    if (caches[key]) return caches[key];
    const mk = () => { const c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height; const x = c.getContext("2d"); x.scale(dpr, dpr); return [c, x]; };
    const [bg, b] = mk();
    if (embed) { // no backdrop at all: the graves are loose glyphs and the ground fades out under them
      b.font = font(); b.textAlign = "center"; b.textBaseline = "middle";
      for (let k = 0; k < ground.length; k++) {
        const gd = ground[k];
        if (gd < 0.15) continue;
        const i = k % cols, j = (k / cols) | 0;
        const fade = j >= hillRow[i] ? 0 : 1; // graves and tree only, no ground
        if (fade <= 0.02) continue;
        const h = hash3(i, j, 4), edge = gd < 0.75;
        b.fillStyle = rgba(pal.embedGround, (edge ? 0.55 : 0.85) * fade);
        b.fillText(edge ? (gd < 0.45 ? "." : ":") : h < 0.4 ? "#" : h < 0.7 ? "%" : h < 0.9 ? "=" : "+", (i + 0.5) * cw, (j + 0.5) * ch);
      }
      return (caches[key] = { bg, vg: null });
    }
    b.fillStyle = rgba(pal.page); b.fillRect(0, 0, W, H);
    const sky = b.createLinearGradient(0, horizon - S * 0.55, 0, horizon + S * 0.05);
    sky.addColorStop(0, rgba(pal.sky, 0)); sky.addColorStop(1, rgba(pal.sky, 1));
    b.fillStyle = sky; b.fillRect(0, horizon - S * 0.55, W, S * 0.6);
    b.font = font(); b.textAlign = "center"; b.textBaseline = "middle";
    for (let k = 0; k < ground.length; k++) {
      const gd = ground[k];
      if (gd < 0.15) continue;
      const i = k % cols, j = (k / cols) | 0;
      b.fillStyle = rgba(pal.ground, Math.min(1, gd * 1.3));
      b.fillRect(i * cw - 0.3, j * ch - 0.3, cw + 0.6, ch + 0.6);
      if (gd < 0.75) { b.fillStyle = rgba(pal.groundEdge, 0.7); b.fillText(gd < 0.45 ? "." : ":", (i + 0.5) * cw, (j + 0.5) * ch); }
    }
    const [vg, v] = mk();
    const grad = v.createRadialGradient(W / 2, H * 0.45, S * 0.3, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
    grad.addColorStop(0, rgba(pal.edge, 0)); grad.addColorStop(1, rgba(pal.edge, pal.edge[3]));
    v.fillStyle = grad; v.fillRect(0, 0, W, H);
    return (caches[key] = { bg, vg });
  }

  // Three kinds, all unmistakably ghosts: wraiths with arms, small quick ones, and big faint
  // shades far back that barely move. They lean into their motion but stay upright.
  const KINDS = {
    wraith: { size: 1, face: true, arms: true, slim: 1, tail: 1, speed: [24, 44], follow: 0.8, maxTilt: 0.3, z: [0.55, 1] },
    wisp: { size: 0.7, face: true, arms: false, slim: 0.88, tail: 1.3, speed: [45, 80], follow: 1.0, maxTilt: 0.4, z: [0.35, 0.85] },
    // a big, faint one that sweeps past close to the viewer and is gone
    passer: { size: 1.9, face: true, arms: true, slim: 1, tail: 1.1, speed: [70, 90], follow: 0.6, maxTilt: 0.25, z: [1, 1], alpha: 0.5, passer: true },
    shade: { size: 1.45, face: true, arms: true, slim: 1.1, tail: 1.25, speed: [10, 18], follow: 0.4, maxTilt: 0.3, z: [0.08, 0.3] },
  };
  let nextId = 0;

  function makeGhost(kind, r) {
    const K = KINDS[kind];
    return {
      id: nextId++, kind, K, z: lerp(K.z[0], K.z[1], r()),
      x: W * r(), y: H * (0.1 + r() * 0.55),
      vx: 0, vy: 0, hd: r() * TAU, speed: lerp(K.speed[0], K.speed[1], r()),
      ph: r() * TAU, ph2: r() * TAU, ph3: r(),
      lean: 0, tilt: 0, wave: r() * 10, startle: 0, blink: 0, blinkAt: 3 + r() * 5, gape: 0.2,
      lookX: 0, lookY: 0, reach: 0, vis: 0, flick: 0, glitch: 0,
      age: 0, life: 14 + r() * 30, leaving: false, gone: false, out: 0, fadeIn: 1.5 + r() * 2,
    };
  }

  const radius = (g) => clamp(S * (0.055 + 0.03 * g.z), 22, 72) * g.K.size * (embed ? 1.6 : rec ? 1.15 : 1);

  /** Where the shroud trails: away from the motion, and down when still. */
  function trailTilt(g, vx, vy) {
    const sp = Math.hypot(vx, vy);
    const k = clamp(sp / 55, 0, 1.6) * g.K.follow;
    const dx = sp ? -vx / sp * k : 0, dy = (sp ? -vy / sp * k : 0) + 1;
    return clamp(Math.atan2(-dx, dy), -g.K.maxTilt, g.K.maxTilt);
  }

  // --------------------------------------------------------------- motion

  /** Record mode: four figures on paths whose periods divide the loop, so it closes seamlessly. */
  function recordCast() {
    const r = rng(seed);
    const cast = [makeGhost("shade", r), makeGhost("wisp", r), makeGhost("wraith", r), makeGhost("passer", r)];
    cast[0].z = 0.2; cast[1].z = 0.6; cast[2].z = 0.9;
    return cast;
  }

  function poseLoop(g, idx, t) {
    const w = TAU / loopT, u = t / loopT;
    let x, y, vx, vy;
    if (g.kind === "passer") { // sweeps left to right, close and faint, once a loop
      const span = W * 1.9, f = ((u + 0.15) % 1 + 1) % 1;
      x = -W * 0.45 + f * span; y = H * 0.4 + H * 0.05 * Math.sin(TAU * f * 2 + g.ph);
      vx = span / loopT; vy = H * 0.05 * TAU * 2 / loopT * Math.cos(TAU * f * 2 + g.ph);
    } else if (g.kind === "wisp") { // weaves right to left across the whole frame
      const f = ((u + g.ph3) % 1 + 1) % 1, span = W * 1.4;
      x = W * 1.2 - f * span;
      y = H * 0.36 + H * 0.1 * Math.sin(TAU * 2 * f + g.ph);
      vx = -span / loopT; vy = H * 0.1 * TAU * 2 / loopT * Math.cos(TAU * 2 * f + g.ph);
    } else if (g.kind === "wraith") { // a wide, slow figure eight just right of centre
      x = W * 0.58 + W * 0.2 * Math.sin(w * t + g.ph);
      y = H * 0.3 + H * 0.08 * Math.sin(2 * w * t + g.ph2);
      vx = W * 0.2 * w * Math.cos(w * t + g.ph); vy = H * 0.08 * 2 * w * Math.cos(2 * w * t + g.ph2);
    } else { // far back on the left, barely moving
      x = W * 0.2 + W * 0.05 * Math.sin(w * t + g.ph);
      y = H * 0.26 + H * 0.04 * Math.sin(w * t + g.ph2);
      vx = W * 0.05 * w * Math.cos(w * t + g.ph); vy = H * 0.04 * w * Math.cos(w * t + g.ph2);
    }
    g.x = x; g.y = y; g.vx = vx; g.vy = vy;
    g.tilt = trailTilt(g, vx, vy);
    g.lean = clamp(vx / 40, -1, 1) * 0.3;
    g.wave = TAU * 4 * t / loopT + g.ph;
    const sp = Math.hypot(vx, vy) || 1;
    g.lookX = (vx / sp) * 0.7; g.lookY = 0.2;
    g.reach = 0.5 + 0.5 * Math.sin(w * t + g.ph2);
    g.gape = 0.25 + 0.25 * Math.sin(2 * w * t + g.ph);
    const v = ((u + g.ph3) % 1 + 1) % 1;
    g.blink = v > 0.5 && v < 0.52 ? 1 : 0;
    const burst = g.kind === "wraith" && v > 0.8 && v < 0.86;
    g.glitch = burst ? 1 : 0;
    g.vis = burst ? (Math.sin(t * TAU * 24 / loopT * 10) > -0.2 ? 0.9 : 0.25) : 1;
  }

  /** Live: how many there are drifts over time; they come and go on their own. */
  function population(dt) {
    const max = clamp(Math.round((W * H) / 190000), 3, 7);
    const want = Math.round(lerp(2, max, smoothstep(0.25, 0.75, valueNoise(time * 0.035, 3.7, seed))));
    const alive = ghosts.filter((g) => !g.leaving).length;
    if (alive < want && Math.random() < dt * 0.6) {
      const roll = Math.random();
      const g = makeGhost(roll < 0.42 ? "wraith" : roll < 0.8 ? "wisp" : roll < 0.93 ? "shade" : "passer", Math.random);
      if (g.K.passer || Math.random() < 0.5) { // drift in from an edge
        const side = Math.random() < 0.5 ? -1 : 1, r = radius(g);
        g.x = side < 0 ? -r * 2 : W + r * 2;
        g.vx = -side * g.speed; g.hd = side < 0 ? 0 : Math.PI;
        g.fadeIn = 0.4;
      }
      ghosts.push(g);
    }
    if (alive > want && Math.random() < dt * 0.2) {
      const c = ghosts.filter((g) => !g.leaving);
      c[(Math.random() * c.length) | 0].leaving = true;
    }
    ghosts = ghosts.filter((g) => !g.gone);
    ghosts.sort((a, b) => a.z - b.z);
  }

  function step(dt) {
    const idle = time - ptr.lastMove;
    ptr.light += ((idle < 3 && ptr.x > -1e4 ? 1 : 0) - ptr.light) * Math.min(1, dt * 2);
    population(dt);
    for (const g of ghosts) {
      const r = radius(g);
      g.age += dt;
      if (g.age > g.life && !g.K.passer) g.leaving = true;
      // a slow current runs through the whole page; each one also wanders on its own
      const fa = valueNoise(g.x / S * 1.3 + time * 0.04, g.y / S * 1.3, seed + 77) * TAU * 2;
      g.hd += (valueNoise(time * 0.15, g.id * 7.31, seed) - 0.5) * dt * 3.2;
      const sp = g.speed * (0.55 + 0.45 * Math.sin(time * 0.33 + g.ph));
      let tx = (Math.cos(g.hd) * 0.6 + Math.cos(fa) * 0.4) * sp;
      let ty = (Math.sin(g.hd) * 0.6 + Math.sin(fa) * 0.4) * sp * 0.75;
      // sudden darts, then drifting again
      if (Math.random() < dt * (g.kind === "wisp" ? 0.25 : 0.1)) {
        const a = g.hd + (Math.random() - 0.5) * 2.4, p = 120 + Math.random() * 140;
        g.vx += Math.cos(a) * p; g.vy += Math.sin(a) * p * 0.7; g.hd = a;
        if (Math.random() < 0.5) g.flick = 0.35;
      }
      if (g.K.passer) { // straight across, then gone
        tx = Math.sign(g.vx || 1) * g.speed; ty *= 0.3;
        if (g.x < -r * 3 || g.x > W + r * 3) g.gone = g.age > 2;
      }
      // keep clear of the text: the head and the hanging shroud both stay off it
      for (const b of avoidRects) {
        const l = b.left - r * 1.3, rt = b.right + r * 1.3, tp = b.top - r * 3.2, bt = b.bottom + r * 1.1;
        if (g.x > l && g.x < rt && g.y > tp && g.y < bt) {
          const pushX = g.x - l < rt - g.x ? -(g.x - l) : rt - g.x, pushY = g.y - tp < bt - g.y ? -(g.y - tp) : bt - g.y;
          if (Math.abs(pushX) < Math.abs(pushY)) tx += pushX * 1.5; else ty += pushY * 1.5;
        }
      }
      if (!g.leaving && !g.K.passer) { // soft edges: they may brush past, but turn back
        const m = -r * 0.5;
        if (g.x < m) tx += (m - g.x) * 1.2;
        if (g.x > W - m) tx -= (g.x - (W - m)) * 1.2;
        if (g.y < r * 0.8) ty += (r * 0.8 - g.y) * 0.4;
        if (g.y > horizon - r * 0.6) ty -= (g.y - (horizon - r * 0.6)) * 0.4;
      }
      const dx = ptr.x - g.x, dy = ptr.y - g.y, d = Math.hypot(dx, dy);
      const near = g.K.face && idle > 0.6 && idle < 10 && d < S * 0.55;
      if (near && d > r * 3) { const k = 0.7 * (1 - d / (S * 0.55)); tx += (dx / d) * 34 * k; ty += (dy / d) * 34 * k; }
      g.reach += ((near && d < S * 0.3 ? 1 : 0) - g.reach) * Math.min(1, dt * 1.5);
      for (const o of ghosts) {
        if (o === g) continue;
        const ox = g.x - o.x, oy = g.y - o.y, od = Math.hypot(ox, oy) || 1, room = (r + radius(o)) * 1.6;
        if (od < room) { tx += (ox / od) * (room - od) * 0.8; ty += (oy / od) * (room - od) * 0.8; }
      }
      g.vx += (tx - g.vx) * Math.min(1, dt * 0.7);
      g.vy += (ty - g.vy) * Math.min(1, dt * 0.7);
      g.x += g.vx * dt; g.y += g.vy * dt;
      // the shroud swings round to trail behind, with a little lag
      const target = trailTilt(g, g.vx, g.vy);
      let da = target - g.tilt; da = Math.atan2(Math.sin(da), Math.cos(da));
      g.tilt += da * Math.min(1, dt * 2.2);
      g.lean += (clamp(g.vx / 40, -1, 1) * 0.3 - g.lean) * Math.min(1, dt * 2.5);
      g.startle *= Math.exp(-dt * 0.9);
      g.scatter = (g.scatter || 0) * Math.exp(-dt * 0.7);
      g.wave += dt * (1.6 + g.startle * 5 + Math.hypot(g.vx, g.vy) * 0.012);
      let lx = g.vx, ly = g.vy * 0.3 + 4, ll = Math.hypot(lx, ly) || 1;
      if (near) { lx = dx; ly = dy; ll = d || 1; }
      g.lookX += ((lx / ll) * 0.9 - g.lookX) * Math.min(1, dt * 2);
      g.lookY += ((ly / ll) * 0.6 - g.lookY) * Math.min(1, dt * 2);
      g.gape += ((0.2 + 0.15 * Math.sin(time * 0.6 + g.ph) + g.startle * 0.9) - g.gape) * Math.min(1, dt * 6);
      g.blinkAt -= dt;
      if (g.blinkAt <= 0) { g.blink = 1; g.blinkAt = 4 + Math.random() * 7; }
      g.blink = Math.max(0, g.blink - dt * 5);
      if (Math.random() < dt * 0.04) g.flick = 0.6;
      g.flick = Math.max(0, g.flick - dt);
      // fade in on arrival; dissolve when leaving, or simply drift off the page
      let life = smoothstep(0, g.fadeIn, g.age);
      if (g.leaving) {
        g.out += dt;
        life *= 1 - smoothstep(0, 2.5, g.out);
        const off = g.x < -r * 3 || g.x > W + r * 3 || g.y < -r * 4 || g.y > H + r * 2;
        if (g.out > 2.6 || off) g.gone = true;
      }
      const flickering = g.flick > 0 || (g.age < g.fadeIn && g.fadeIn > 1);
      g.glitch = Math.max(flickering ? 1 : 0, g.startle * 0.8);
      g.vis = life * (flickering && Math.sin(time * 60 + g.id) > 0.3 ? 0.3 : 1) * (1 - 0.85 * (g.scatter || 0));
    }
    nextFlash -= dt;
    if (nextFlash <= 0) { flash = 1; nextFlash = 18 + Math.random() * 26; }
    flash = Math.max(0, flash - dt * 1.4);
    for (let i = ripples.length - 1; i >= 0; i--) if (time - ripples[i].t0 > 2.6) ripples.splice(i, 1);
  }

  // --------------------------------------------------------------- fog

  function fogField(px, py, t) {
    const x = px / S, y = py / S;
    const q = fbm(x * 1.1 + t * 0.025, y * 2.0 - t * 0.01, seed + 3, 3);
    return fbm(x * 1.4 + q * 1.5 - t * 0.02, y * 2.6 + q, seed + 9, 3);
  }

  function computeFog(t) {
    const w = loopT ? t / loopT : 0;
    const norm = loopT ? 1 / Math.sqrt((1 - w) ** 2 + w * w) : 1;
    for (let gj = 0; gj < grows; gj++) for (let gi = 0; gi < gcols; gi++) {
      const px = gi * 2 * cw, py = gj * 2 * ch;
      let d = fogField(px, py, t);
      if (loopT) d = 0.5 + ((1 - w) * d + w * fogField(px, py, t - loopT) - 0.5) * norm;
      fogGrid[gj * gcols + gi] = d;
    }
  }

  const lowFog = (j) => smoothstep(horizon - S * 0.28, horizon + S * 0.02, (j + 0.5) * ch);

  // --------------------------------------------------------------- wraiths

  function stampGhost(g, t) {
    const r = radius(g), K = g.K;
    const bob = Math.sin(g.wave * 0.5 + g.ph2) * r * 0.16;
    const hx = g.x, hy = g.y + bob;
    const pose = {
      lean: g.lean, wave: g.wave, gape: g.gape, reach: g.reach,
      eye: Math.max(0.08, 1 - g.blink), lookX: g.lookX, lookY: g.lookY,
      face: K.face, arms: K.arms, slim: K.slim, tail: K.tail,
    };
    const tilt = g.tilt + Math.sin(g.wave * 0.25 + g.ph) * 0.06, ct = Math.cos(tilt), st = Math.sin(tilt);
    const depth = (0.45 + 0.55 * g.z) * g.vis * (K.alpha || 1);
    if (depth < 0.02) return;
    const tick = Math.floor(t * 18);
    // bounds of the rotated figure: the head and the far end of the tail, padded by its width
    const Lb = r * WRAITH.bottom * K.tail, pad = r * WRAITH.half * Math.max(1, K.slim) + 5 * cw;
    const ex = hx - Lb * st, ey = hy + Lb * ct;
    const i0 = Math.max(0, Math.floor((Math.min(hx, ex) - pad) / cw)), i1 = Math.min(cols - 1, Math.floor((Math.max(hx, ex) + pad) / cw));
    const j0 = Math.max(0, Math.floor((Math.min(hy, ey) - pad) / ch)), j1 = Math.min(rows - 1, Math.floor((Math.max(hy, ey) + pad) / ch));
    const tailN = 3.5 * K.tail;
    for (let j = j0; j <= j1; j++) {
      const cy = (j + 0.5) * ch;
      const sink = 1 - 0.85 * lowFog(j);
      // glitch: whole rows slip sideways for a moment
      const slip = g.glitch > 0 && hash3(j, tick, g.id) < 0.35 * g.glitch ? (hash3(tick, j, 9) - 0.5) * 5 * cw : 0;
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * cw - slip;
        const dx = (cx - hx) / r, dy = (cy - hy) / r;
        const x = dx * ct + dy * st, y = -dx * st + dy * ct;
        let d = wraithAt(pose, x, y);
        if (d < 0.02) continue;
        const nz = fbm(x * 1.7 + g.id * 13 - g.wave * 0.2, y * 1.4 - g.wave * 0.35, seed + 61, 3);
        d *= 1 - (1 - d) * (1 - d) * 0.95 * clamp(1.7 - nz * 2.4, 0, 1) * (0.3 + clamp(y / tailN, 0, 1));
        const k = j * cols + i;
        const v = clamp(d, 0, 1) * depth * sink;
        if (v > dens[k]) dens[k] = v;
      }
    }
    // specks of the shroud lifting off and fading
    for (let s = 0; s < 8; s++) {
      const rate = rec ? 2 / loopT : 0.35;
      const u = (((t * rate + s / 8 + g.ph3) % 1) + 1) % 1;
      const lx0 = (hash3(g.id, s, 1) - 0.5) * r * 1.6 + Math.sin(u * 4 + s) * r * 0.3;
      const ly0 = r * (1.4 + hash3(g.id, s, 2) * 1.8 * g.K.tail) + u * r * 1.2;
      const sx = hx + lx0 * ct - ly0 * st, sy = hy + lx0 * st + ly0 * ct - u * r * 0.6;
      const i = Math.floor(sx / cw), j = Math.floor(sy / ch);
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const k = j * cols + i;
      dens[k] = Math.max(dens[k], (1 - u) * 0.3 * depth);
    }
  }

  /** Stamp this frame's wraiths, then let last frame's fade behind them as an afterimage. */
  function updateGhosts(t, dt) {
    dens.fill(0);
    for (const g of ghosts) stampGhost(g, t);
    const keep = Math.exp(-dt * 7);
    for (let k = 0; k < trail.length; k++) { const a = trail[k] * keep; trail[k] = dens[k] > a ? dens[k] : a; }
  }

  // --------------------------------------------------------------- drawing

  function drawScene(t) {
    const pal = P;
    const c = cache(pal);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (embed) { ctx.fillStyle = rgba(pal.embedPage); ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(c.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (flash > 0 && pal === THEMES.dark && !embed) { // lightning: two quick pulses, then a slow fade
      const a = flash > 0.75 ? (flash - 0.75) * 4 : flash > 0.55 ? 0.15 : flash * 0.5;
      const g = ctx.createLinearGradient(0, 0, 0, horizon);
      g.addColorStop(0, rgba(pal.flash, a * 0.05)); g.addColorStop(1, rgba(pal.flash, a * 0.35));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon + ch);
    }

    // soft light that follows each wraith's exact shape
    const gd = glowImg.data, gl = pal.glow;
    for (let k = 0, n = trail.length; k < n; k++) {
      const o = k * 4, v = trail[k];
      gd[o] = gl[0]; gd[o + 1] = gl[1]; gd[o + 2] = gl[2];
      gd[o + 3] = v > 0.02 ? Math.min(255, v * 255 * pal.glowA) : 0;
    }
    gctx.putImageData(glowImg, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = embed ? "source-over" : pal.blend;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(glowC, -cw * 0.5, -ch * 0.5, (cols + 1) * cw, (rows + 1) * ch);
    ctx.restore();

    // collect every glyph into colour buckets, then draw bucket by bucket
    counts.fill(0);
    let n = 0;
    const lx = ptr.x, ly = ptr.y, lr2 = (S * 0.22) ** 2, lit = ptr.light;
    for (let j = 0; j < rows; j++) {
      const lf = lowFog(j);
      const cy = (j + 0.5) * ch;
      const fy = j / 2, fyi = fy | 0, ffy = fy - fyi;
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const dim = 1 - 0.8 * avoid[k];
        const v = trail[k];
        let b, ch2;
        if (v >= 0.05) {
          b = Math.round(clamp(v * dim, 0, 1) * (GL - 1));
          ch2 = clamp(Math.round(v * 9.4), 1, 9);
        } else {
          const fx = i / 2, fxi = fx | 0, ffx = fx - fxi, q = fyi * gcols + fxi;
          const raw = lerp(lerp(fogGrid[q], fogGrid[q + 1], ffx), lerp(fogGrid[q + gcols], fogGrid[q + gcols + 1], ffx), ffy);
          let f = smoothstep(0.48, 0.76, raw) * (0.35 + 0.65 * lf) * (embed ? 0.55 : 1);
          if (ground[k] > 0.15 && f < 0.35) continue;
          let boost = 0;
          if (lit > 0.01) { const dx = (i + 0.5) * cw - lx, dy = cy - ly; boost = lit * Math.exp(-(dx * dx + dy * dy) / lr2); }
          f = Math.min(1, f + boost * 0.35);
          if (f < 0.1 || hash3(i, j, 17) > f * 1.4) continue;
          b = GL + Math.round(clamp((0.15 + 0.6 * f + boost * 0.5) * dim, 0, 1) * (FL - 1));
          ch2 = f > 0.62 ? 10 : f > 0.36 ? 3 : 1;
        }
        opB[n] = b; opK[n] = k; opC[n] = ch2; counts[b]++; n++;
      }
    }
    let acc = 0;
    for (let b = 0; b < GL + FL; b++) { starts[b] = acc; acc += counts[b]; }
    for (let m = 0; m < n; m++) order[starts[opB[m]]++] = m;
    ctx.font = font();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let m = 0;
    for (let b = 0; b < GL + FL; b++) {
      const cnt = counts[b];
      if (!cnt) continue;
      ctx.fillStyle = pal.css[b];
      for (let e = 0; e < cnt; e++, m++) {
        const o = order[m], k = opK[o];
        ctx.fillText(CHARS[opC[o]], ((k % cols) + 0.5) * cw, (((k / cols) | 0) + 0.5) * ch);
      }
    }

    for (const rp of ripples) {
      const age = t - rp.t0, rad = 14 + age * 90, a = 1 - age / 2.6;
      if (a <= 0) continue;
      ctx.fillStyle = rgba(pal.ripple, a * 0.6);
      const i0 = Math.max(0, Math.floor((rp.x - rad - cw) / cw)), i1 = Math.min(cols - 1, Math.floor((rp.x + rad + cw) / cw));
      const j0 = Math.max(0, Math.floor((rp.y - rad - ch) / ch)), j1 = Math.min(rows - 1, Math.floor((rp.y + rad + ch) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cw - rp.x, dy = (j + 0.5) * ch - rp.y, d = Math.hypot(dx, dy);
        if (Math.abs(d - rad) < ch * 0.55) ctx.fillText(lineGlyph(-dy, dx), (i + 0.5) * cw, (j + 0.5) * ch);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (c.vg) ctx.drawImage(c.vg, 0, 0);
  }

  function measure() {
    if (!avoid) return;
    avoid.fill(0);
    avoidRects = [];
    for (const el of document.querySelectorAll("[data-sky-avoid]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      avoidRects.push(r);
      const i0 = Math.max(0, Math.floor((r.left - 8) / cw)), i1 = Math.min(cols - 1, Math.floor((r.right + 8) / cw));
      const j0 = Math.max(0, Math.floor((r.top - 4) / ch)), j1 = Math.min(rows - 1, Math.floor((r.bottom + 4) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) avoid[j * cols + i] = 1;
    }
  }

  // --------------------------------------------------------------- record mode

  if (rec) {
    canvas.style.width = rec.width + "px";
    canvas.style.height = rec.height + "px";
    layout(rec.width, rec.height, 1);
    const dt = 1 / rec.fps;
    const advance = (i) => {
      const t = (((i % rec.frames) + rec.frames) % rec.frames) / rec.fps;
      ghosts.forEach((g, n) => poseLoop(g, n, t));
      const u = t / loopT;
      flash = u > 0.42 && u < 0.5 ? 1 - (u - 0.42) / 0.08 : 0;
      computeFog(t);
      updateGhosts(t, dt);
      return t;
    };
    for (let i = -30; i < 0; i++) advance(i); // fill the afterimages so frame 0 follows the last frame
    return {
      frame(i) { const t = advance(i); drawScene(t); return canvas.toDataURL("image/png"); },
      setTheme(light) { P = THEMES[light ? "light" : "dark"]; },
    };
  }

  // --------------------------------------------------------------- live

  const resize = () => layout(canvas.clientWidth, canvas.clientHeight, Math.min(2, devicePixelRatio || 1));
  resize();
  let resizeTimer = 0;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 80); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { caches = {}; });

  addEventListener("pointermove", (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.lastMove = time; }, { passive: true });
  document.addEventListener("pointerleave", () => { ptr.x = ptr.y = -1e5; });
  addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest("a, button, input, textarea, [data-sky-ignore]")) return;
    if (String(getSelection && getSelection())) return;
    ripples.push({ x: e.clientX, y: e.clientY, t0: time });
    for (const g of ghosts) {
      const dx = g.x - e.clientX, dy = g.y - e.clientY, d = Math.hypot(dx, dy) || 1, reach = S * 0.55;
      if (d > reach) continue;
      const k = 1 - d / reach;
      g.startle = Math.max(g.startle, 0.5 + 0.5 * k);
      g.scatter = Math.max(g.scatter || 0, k); // they all but vanish, then drift back
      g.vx += (dx / d) * 380 * k; g.vy += (dy / d) * 280 * k;
      g.hd = Math.atan2(dy, dx);
      g.flick = 0.5;
    }
  });

  let lastNow = performance.now();
  const frameTimes = [];
  function advance(dt, draw = true) {
    time += dt;
    step(dt);
    computeFog(time);
    updateGhosts(time, dt);
    if (draw) drawScene(time);
  }
  function frame(now) {
    // rAF timestamps can land just before the last one; never step backwards
    const dt = clamp((now - lastNow) / 1000, 0, 0.05) * (reducedMotion.matches ? 0.2 : 1);
    lastNow = now;
    const t0 = performance.now();
    advance(dt);
    frameTimes.push(performance.now() - t0);
    if (frameTimes.length > 120) frameTimes.shift();
  }
  function tick(now) { requestAnimationFrame(tick); frame(now); }
  requestAnimationFrame(tick);

  return {
    measure,
    /** Draw right now, so a view transition captures the new theme. */
    redraw() { drawScene(time); },
    setTheme(light) { P = THEMES[light ? "light" : "dark"]; },
    stats() { const a = [...frameTimes].sort((x, y) => x - y); return { median: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)] }; },
  };
}
