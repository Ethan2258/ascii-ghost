// ASCII blood moon: a glowing red moon in swirling crimson cloud, with crows crossing it.
// The cloud and the moon's surface are glyphs on a cell grid; the crows are smooth silhouettes
// with a glyph texture. One canvas, no build step, no dependencies.
//
//   mount(canvas, { theme: "dark" | "light" })                    live page
//   mount(canvas, { record: { width, height, frames, fps } })     deterministic seamless loop,
//                                                                 drive it with frame(i)

import { TAU, clamp, lerp, smoothstep, mixRgb, ramp, rgba, rng, hash3, fbm, lineGlyph } from "./util.js";
import { drawCrow, flapPose } from "./crow.js";

const LV = 48;
const MOON_TEX = ".:-=+*#%";

const THEMES = {
  dark: {
    page: [11, 4, 5],
    halo: [[150, 22, 24, 0.55], [80, 12, 15, 0.32], [30, 6, 8, 0.12], [11, 4, 5, 0]],
    cloud: [[78, 12, 15], [128, 18, 22], [184, 30, 30], [226, 62, 50], [255, 140, 112]],
    cloudAlpha: [0.28, 0.95],
    disc: [[255, 132, 104], [236, 70, 54], [196, 34, 32], [128, 16, 20]],
    glow: "rgba(236, 48, 42, 0.75)",
    moonDark: [96, 8, 12], moonLight: [255, 200, 172],
    wisp: [26, 4, 6],
    crow: [9, 2, 3], crowFar: [92, 16, 18], crowTex: [70, 14, 16], rim: "rgba(255, 60, 44, 0.55)",
    ripple: [255, 170, 140],
  },
  light: {
    page: [245, 240, 235],
    halo: [[236, 160, 150, 0.6], [240, 196, 188, 0.4], [243, 222, 216, 0.2], [245, 240, 235, 0]],
    cloud: [[226, 176, 170], [204, 128, 122], [176, 72, 70], [146, 34, 36], [104, 14, 18]],
    cloudAlpha: [0.35, 0.95],
    disc: [[250, 140, 112], [232, 72, 56], [200, 38, 36], [140, 20, 24]],
    glow: "rgba(220, 70, 60, 0.45)",
    moonDark: [110, 10, 14], moonLight: [255, 214, 196],
    wisp: [250, 236, 232],
    crow: [24, 8, 10], crowFar: [170, 120, 118], crowTex: [92, 36, 38], rim: "rgba(190, 30, 30, 0.35)",
    ripple: [150, 22, 26],
  },
};
for (const t of Object.values(THEMES)) {
  t.cloudCss = [];
  for (let i = 0; i < LV; i++) {
    const k = i / (LV - 1);
    t.cloudCss.push(rgba(ramp(t.cloud, k), lerp(t.cloudAlpha[0], t.cloudAlpha[1], k)));
  }
}

export function mount(canvas, opts = {}) {
  const ctx = canvas.getContext("2d");
  const rec = opts.record || null;
  const loopT = rec ? rec.frames / rec.fps : 0;
  const seed = rec ? 2258 : (Math.random() * 1e6) | 0;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  let P = THEMES[opts.theme === "light" ? "light" : "dark"];
  let reveal = null;

  let W = 0, H = 0, S = 0, dpr = 1, cw = 8, ch = 10, cols = 0, rows = 0, portrait = false;
  const moon = { x: 0, y: 0, R: 0 };
  let glow, flow, avoid, gcols = 0, grows = 0, cd, cf;
  let moonCells = [];
  let moonImg = {}; // pre-rendered moon per theme
  const soft = document.createElement("canvas"); // cloud, one pixel per grid node, scaled up smooth
  const sctx = soft.getContext("2d");
  let softImg = null;
  let crows = [];
  const ripples = [];
  const ptr = { x: -1e5, y: -1e5, inf: 0, lastMove: -1e9 };
  let time = 0;

  // --------------------------------------------------------------- layout

  function layout(w, h, ratio) {
    W = w; H = h; dpr = ratio; S = Math.min(W, H);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    cw = clamp(Math.round(W / 170), 6, 10);
    ch = Math.round(cw * 1.3);
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / ch);
    portrait = H > W * 1.1;
    moon.R = portrait ? W * 0.34 : clamp(S * 0.32, 60, 330);
    moon.x = portrait ? W * 0.6 : W * 0.64;
    moon.y = portrait ? H * 0.27 : H * 0.42;

    const n = cols * rows;
    glow = new Float32Array(n); flow = new Array(n); avoid = new Float32Array(n);
    moonCells = [];
    const R = moon.R;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const cx = (i + 0.5) * cw, cy = (j + 0.5) * ch;
        const dx = cx - moon.x, dy = cy - moon.y, d = Math.hypot(dx, dy) || 1;
        glow[k] = d <= R ? 1 : Math.exp(-(d - R) / (R * 0.9));
        // the cloud streams round the moon, spiralling slightly in
        flow[k] = lineGlyph(-dy / d - 0.35 * dx / d, dx / d - 0.35 * dy / d);
        if (d < R - cw * 0.6) {
          const lx = dx / R, ly = dy / R;
          const mu = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
          moonCells.push({
            i, j, mu,
            mar: smoothstep(0.46, 0.66, fbm(lx * 2.2 + 3.3, ly * 2.2 + 7.1, 31, 5)),
            det: fbm(lx * 8 + 1.1, ly * 8 + 4.2, 32, 3),
            h: hash3(i, j, 9),
          });
        }
      }
    }
    gcols = Math.ceil(cols / 2) + 2; grows = Math.ceil(rows / 2) + 2;
    cd = new Float32Array(gcols * grows); cf = new Float32Array(gcols * grows);
    soft.width = gcols; soft.height = grows;
    softImg = sctx.createImageData(gcols, grows);
    moonImg = {};

    const want = clamp(Math.round((W * H) / 110000), 5, 9);
    if (crows.length !== want) {
      const r = rng(seed);
      crows = [];
      for (let i = 0; i < want; i++) crows.push(makeCrow(i, r));
      crows.sort((a, b) => a.z - b.z);
    }
    measure();
  }

  /** The moon never changes, so it is painted once per theme and size. */
  function moonImage(pal) {
    const key = pal === THEMES.light ? "light" : "dark";
    if (moonImg[key]) return moonImg[key];
    const R = moon.R, pad = Math.ceil(R * 0.6);
    const c = document.createElement("canvas");
    const size = Math.ceil((R + pad) * 2);
    c.width = Math.ceil(size * dpr); c.height = Math.ceil(size * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const ox = moon.x - (R + pad), oy = moon.y - (R + pad);
    g.translate(-ox, -oy);
    g.save();
    g.shadowColor = pal.glow;
    g.shadowBlur = R * 0.45 * dpr;
    const grad = g.createRadialGradient(moon.x + R * 0.28, moon.y - R * 0.3, R * 0.05, moon.x, moon.y, R);
    pal.disc.forEach((col, i) => grad.addColorStop(i / (pal.disc.length - 1), rgba(col)));
    g.fillStyle = grad;
    g.beginPath(); g.arc(moon.x, moon.y, R, 0, TAU); g.fill();
    g.restore();
    // maria: a small alpha map, scaled up smooth and clipped to the disc
    const mres = 72, mc = document.createElement("canvas");
    mc.width = mc.height = mres;
    const mx = mc.getContext("2d"), md = mx.createImageData(mres, mres);
    for (let y = 0; y < mres; y++) for (let x = 0; x < mres; x++) {
      const lx = (x + 0.5) / mres * 2 - 1, ly = (y + 0.5) / mres * 2 - 1;
      const mar = smoothstep(0.44, 0.68, fbm(lx * 2.2 + 3.3, ly * 2.2 + 7.1, 31, 5));
      const crater = smoothstep(0.6, 0.75, fbm(lx * 6 + 9.1, ly * 6 + 2.7, 33, 3));
      const o = (y * mres + x) * 4;
      md.data[o] = pal.moonDark[0]; md.data[o + 1] = pal.moonDark[1]; md.data[o + 2] = pal.moonDark[2];
      md.data[o + 3] = Math.round(255 * clamp(mar * 0.55 + crater * 0.3, 0, 0.75));
    }
    mx.putImageData(md, 0, 0);
    g.save();
    g.beginPath(); g.arc(moon.x, moon.y, R, 0, TAU); g.clip();
    g.imageSmoothingQuality = "high";
    g.drawImage(mc, moon.x - R, moon.y - R, R * 2, R * 2);
    const limb = g.createRadialGradient(moon.x, moon.y, R * 0.55, moon.x, moon.y, R);
    limb.addColorStop(0, rgba(pal.moonDark, 0));
    limb.addColorStop(1, rgba(pal.moonDark, 0.55));
    g.fillStyle = limb;
    g.fillRect(moon.x - R, moon.y - R, R * 2, R * 2);
    g.restore();
    // surface glyphs: maria in dark glyphs, highlands speckled light
    g.font = font();
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const m of moonCells) {
      const cx = (m.i + 0.5) * cw, cy = (m.j + 0.5) * ch;
      const limb = 1 - m.mu;
      const dark = clamp(m.mar * 0.9 + limb * limb * 0.6 + (m.det - 0.5) * 0.5, 0, 1);
      if (dark > 0.12) {
        g.fillStyle = rgba(pal.moonDark, 0.18 + dark * 0.6);
        g.fillText(MOON_TEX[Math.min(MOON_TEX.length - 1, Math.floor(dark * MOON_TEX.length))], cx, cy);
      } else if (m.det > 0.55 && m.h < 0.55) {
        g.fillStyle = rgba(pal.moonLight, 0.25 + (m.det - 0.55) * 1.5);
        g.fillText(m.h < 0.25 ? "." : ":", cx, cy);
      }
    }
    moonImg[key] = { c, x: ox, y: oy, size };
    return moonImg[key];
  }

  // --------------------------------------------------------------- crows

  function makeCrow(i, r) {
    const orbit = i % 3 === 1;
    const per = loopT || (orbit ? 18 + r() * 10 : 15 + r() * 12);
    const flapF = loopT ? Math.round(loopT * (2.0 + r() * 0.9)) / loopT : 2.0 + r() * 0.9;
    const glideF = loopT ? 1 / loopT : 0.07 + r() * 0.07;
    return {
      orbit, per, flapF, glideF,
      z: (i + r() * 0.8) / 9,
      dir: r() < 0.5 ? -1 : 1,
      ph: r() * TAU, fph: r() * TAU, gph: r() * TAU,
      ring: 1.15 + r() * 0.7, squash: 0.35 + r() * 0.25,
      y0: 0.12 + r() * 0.76, bob: 0.03 + r() * 0.06, m: 1 + ((r() * 2) | 0),
      ox: 0, oy: 0, vx: 0, vy: 0, boost: 0, xph: 0,
    };
  }

  function crowPath(c, t) {
    const w = TAU / c.per;
    if (c.orbit) {
      const a = c.ph + c.dir * w * t;
      const rr = moon.R * c.ring, ry = rr * c.squash;
      return [moon.x + Math.cos(a) * rr, moon.y + Math.sin(a) * ry,
              -Math.sin(a) * rr * c.dir * w, Math.cos(a) * ry * c.dir * w];
    }
    const margin = S * 0.35, span = W + 2 * margin;
    const f = (((c.ph / TAU + t / c.per) % 1) + 1) % 1;
    const x = c.dir > 0 ? -margin + f * span : W + margin - f * span;
    const y = H * c.y0 + Math.sin(w * c.m * t + c.ph) * H * c.bob;
    return [x, y, c.dir * span / c.per, Math.cos(w * c.m * t + c.ph) * H * c.bob * w * c.m];
  }

  /** Pose every crow at time t: where it is, how big, which way it heads, and its wings. */
  function poseCrows(t) {
    return crows.map((c) => {
      let [x, y, vx, vy] = crowPath(c, t);
      x += c.ox; y += c.oy; vx += c.vx; vy += c.vy;
      const L = S * (0.05 + 0.095 * Math.pow(c.z, 1.5)) * (portrait ? 1.25 : 1); // half wingspan
      const phase = TAU * c.flapF * t + c.fph + c.xph;
      const g = 0.5 + 0.5 * Math.sin(TAU * c.glideF * t + c.gph);
      const amp = Math.max(c.boost, smoothstep(0.22, 0.55, g));
      const { span, sweep } = flapPose(phase, amp);
      const bank = c.orbit ? -c.dir * 0.45 : clamp(c.vy / (S * 0.5), -0.5, 0.5);
      return { c, x, y, L, span, sweep, bank, ang: Math.atan2(vy, vx) };
    });
  }

  function drawCrows(t, pal) {
    for (const p of poseCrows(t)) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      ctx.scale(p.L, p.L);
      const fog = Math.pow(1 - p.c.z, 2) * 0.4;
      ctx.fillStyle = rgba(mixRgb(pal.crow, pal.crowFar, fog));
      ctx.shadowColor = pal.rim;
      ctx.shadowBlur = (2 + 4 * p.c.z) * dpr;
      drawCrow(ctx, p.span, p.sweep, p.bank);
      ctx.restore();
    }
  }

  // --------------------------------------------------------------- clouds

  let fd = 0, ff = 0;
  function field(px, py, t) {
    const x = (px - moon.x) / S, y = (py - moon.y) / S;
    const r = Math.sqrt(x * x + y * y);
    const ang = 1.2 / (0.45 + r * 2.4) + t * 0.035; // a fixed spiral, turned slowly as a whole
    const c = Math.cos(ang), s = Math.sin(ang);
    // stretched across the radius so the cloud reads as streaks, not blobs
    const u = (x * c - y * s) * 2.2, v = (x * s + y * c) * 4.4;
    const q1 = fbm(u + t * 0.05, v - t * 0.035, seed + 11, 3);
    const q2 = fbm(u - t * 0.04 + 5.2, v + 1.3 + t * 0.03, seed + 23, 3);
    fd = fbm(u + 1.5 * q1 + t * 0.025, v + 1.5 * q2, seed + 37, 4);
    ff = fbm(u * 0.8 + 2 * q2 - t * 0.04, v * 0.8 + q1, seed + 51, 3);
  }

  function computeClouds(t) {
    const holeR2 = (S * 0.15) ** 2;
    const w = loopT ? t / loopT : 0;
    const norm = loopT ? 1 / Math.sqrt((1 - w) ** 2 + w * w) : 1;
    for (let gj = 0; gj < grows; gj++) {
      for (let gi = 0; gi < gcols; gi++) {
        let px = gi * 2 * cw, py = gj * 2 * ch;
        if (ptr.inf > 0.01) {
          const dx = px - ptr.x, dy = py - ptr.y, d2 = dx * dx + dy * dy;
          const f = Math.exp(-d2 / holeR2) * ptr.inf;
          if (f > 0.01) { const d = Math.sqrt(d2) || 1; px += (dx / d) * f * S * 0.1; py += (dy / d) * f * S * 0.1; }
        }
        field(px, py, t);
        let d = fd, fr = ff;
        if (loopT) { // seamless loop: cross-fade with the field one period back
          const d1 = d, f1 = fr;
          field(px, py, t - loopT);
          d = 0.5 + ((1 - w) * d1 + w * fd - 0.5) * norm;
          fr = 0.5 + ((1 - w) * f1 + w * ff - 0.5) * norm;
        }
        cd[gj * gcols + gi] = d; cf[gj * gcols + gi] = fr;
      }
    }
  }

  function sampleGrid(arr, i, j) {
    const x = i / 2, y = j / 2, xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
    const k = yi * gcols + xi;
    return lerp(lerp(arr[k], arr[k + 1], fx), lerp(arr[k + gcols], arr[k + gcols + 1], fx), fy);
  }

  // --------------------------------------------------------------- drawing

  function font() {
    return `500 ${Math.round(ch * 0.82)}px "Geist Mono", ui-monospace, Consolas, Menlo, monospace`;
  }

  function drawScene(t, pal) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = rgba(pal.page);
    ctx.fillRect(0, 0, W, H);
    const pulse = 1 + 0.05 * Math.sin(TAU * t / (loopT || 7));
    const R = moon.R;
    const halo = ctx.createRadialGradient(moon.x, moon.y, R * 0.9, moon.x, moon.y, R * 3.6 * pulse);
    pal.halo.forEach((c, i) => halo.addColorStop(i / (pal.halo.length - 1), rgba(c, c[3])));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    ctx.font = font();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // back cloud: a soft painted layer, then glyph streaks that follow the swirl
    const sd = softImg.data;
    for (let gj = 0; gj < grows; gj++) for (let gi = 0; gi < gcols; gi++) {
      const gk = gj * gcols + gi, o = gk * 4;
      const ci = Math.min(cols - 1, gi * 2), cj = Math.min(rows - 1, gj * 2);
      const gl = glow[cj * cols + ci] * pulse;
      const v = smoothstep(0.36, 0.72, cd[gk]) * (0.35 + 0.65 * gl);
      const col = ramp(pal.cloud, v * 0.9);
      sd[o] = col[0]; sd[o + 1] = col[1]; sd[o + 2] = col[2];
      sd[o + 3] = Math.round(255 * clamp(v * 0.85, 0, 0.8));
    }
    sctx.putImageData(softImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(soft, 0, 0, gcols * 2 * cw, grows * 2 * ch);
    let last = "";
    const R2 = (R - cw) * (R - cw);
    for (let j = 0; j < rows; j++) {
      const cy = (j + 0.5) * ch;
      for (let i = 0; i < cols; i++) {
        const cx = (i + 0.5) * cw;
        const dmx = cx - moon.x, dmy = cy - moon.y;
        if (dmx * dmx + dmy * dmy < R2) continue;
        const k = j * cols + i;
        const d = sampleGrid(cd, i, j);
        const gl = glow[k] * pulse;
        let v = smoothstep(0.42, 0.74, d) * (0.4 + 0.6 * gl);
        v *= 1 - 0.75 * avoid[k];
        if (v < 0.1) continue;
        const g = v < 0.22 ? "." : v < 0.45 ? flow[k] : v < 0.7 ? "~" : (hash3(i, j, 2) < 0.5 ? "=" : "~");
        const st = pal.cloudCss[Math.round(clamp(v, 0, 1) * (LV - 1))];
        if (st !== last) { ctx.fillStyle = st; last = st; }
        ctx.fillText(g, cx, cy);
      }
    }

    // the moon, then thin dark cloud drifting across it
    const mi = moonImage(pal);
    ctx.drawImage(mi.c, mi.x, mi.y, mi.size, mi.size);
    const j0 = Math.max(0, Math.floor((moon.y - R * 1.1) / ch)), j1 = Math.min(rows - 1, Math.ceil((moon.y + R * 1.1) / ch));
    const i0 = Math.max(0, Math.floor((moon.x - R * 1.1) / cw)), i1 = Math.min(cols - 1, Math.ceil((moon.x + R * 1.1) / cw));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * cw, cy = (j + 0.5) * ch;
        if (Math.hypot(cx - moon.x, cy - moon.y) > R * 1.02) continue;
        const fr = smoothstep(0.52, 0.7, sampleGrid(cf, i, j));
        if (fr < 0.05) continue;
        ctx.fillStyle = rgba(pal.wisp, 0.25 + fr * 0.6);
        ctx.fillText(fr > 0.6 ? "~" : fr > 0.3 ? flow[j * cols + i] : ".", cx, cy);
      }
    }

    // ripples from clicks
    for (const r of ripples) {
      const age = t - r.t0, rad = age * S * 0.42, a = 1 - age / 2.4;
      if (a <= 0) continue;
      ctx.fillStyle = rgba(pal.ripple, a * 0.9);
      const glyph = age < 0.5 ? "*" : age < 1.3 ? "+" : ".";
      const ri0 = Math.max(0, Math.floor((r.x - rad - cw) / cw)), ri1 = Math.min(cols - 1, Math.floor((r.x + rad + cw) / cw));
      const rj0 = Math.max(0, Math.floor((r.y - rad - ch) / ch)), rj1 = Math.min(rows - 1, Math.floor((r.y + rad + ch) / ch));
      for (let j = rj0; j <= rj1; j++) for (let i = ri0; i <= ri1; i++) {
        const cx = (i + 0.5) * cw, cy = (j + 0.5) * ch;
        if (Math.abs(Math.hypot(cx - r.x, cy - r.y) - rad) < ch * 0.6) ctx.fillText(glyph, cx, cy);
      }
    }

    drawCrows(t, pal);
  }

  function render(t) {
    computeClouds(t);
    if (reveal) {
      const k = clamp((performance.now() - reveal.start) / 800, 0, 1);
      const far = Math.max(Math.hypot(reveal.x, reveal.y), Math.hypot(W - reveal.x, reveal.y),
                           Math.hypot(reveal.x, H - reveal.y), Math.hypot(W - reveal.x, H - reveal.y));
      drawScene(t, reveal.from);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(reveal.x, reveal.y, far * (1 - (1 - k) ** 3), 0, TAU);
      ctx.clip();
      drawScene(t, P);
      ctx.restore();
      if (k >= 1) reveal = null;
    } else {
      drawScene(t, P);
    }
  }

  // --------------------------------------------------------------- live loop

  function step(dt) {
    ptr.inf = time - ptr.lastMove < 1.2 ? Math.min(1, ptr.inf + dt * 3) : Math.max(0, ptr.inf - dt * 0.8);
    for (const c of crows) {
      c.vx += (-1.6 * c.ox - 1.8 * c.vx) * dt;
      c.vy += (-1.6 * c.oy - 1.8 * c.vy) * dt;
      c.ox += c.vx * dt; c.oy += c.vy * dt;
      c.xph += c.boost * dt * 14;
      c.boost *= Math.exp(-dt * 0.8);
    }
    for (let i = ripples.length - 1; i >= 0; i--) if (time - ripples[i].t0 > 2.4) ripples.splice(i, 1);
  }

  function measure() {
    if (!avoid) return;
    avoid.fill(0);
    for (const el of document.querySelectorAll("[data-sky-avoid]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const i0 = Math.max(0, Math.floor((r.left - 8) / cw)), i1 = Math.min(cols - 1, Math.floor((r.right + 8) / cw));
      const j0 = Math.max(0, Math.floor((r.top - 4) / ch)), j1 = Math.min(rows - 1, Math.floor((r.bottom + 4) / ch));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) avoid[j * cols + i] = 1;
    }
  }

  if (rec) {
    canvas.style.width = rec.width + "px";
    canvas.style.height = rec.height + "px";
    layout(rec.width, rec.height, 1);
    return {
      frame(i) {
        render((i % rec.frames) / rec.fps);
        return canvas.toDataURL("image/png");
      },
      setTheme(light) { P = THEMES[light ? "light" : "dark"]; },
    };
  }

  const resize = () => layout(canvas.clientWidth, canvas.clientHeight, Math.min(2, devicePixelRatio || 1));
  resize();
  let resizeTimer = 0;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 80); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { moonImg = {}; });

  addEventListener("pointermove", (e) => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.lastMove = time; }, { passive: true });
  document.addEventListener("pointerleave", () => { ptr.lastMove = -1e9; });
  addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest("a, button, input, textarea, [data-sky-ignore]")) return;
    if (String(getSelection && getSelection())) return;
    ripples.push({ x: e.clientX, y: e.clientY, t0: time });
    const reach = S * 0.5;
    for (const c of crows) {
      const [px, py] = crowPath(c, time);
      const dx = px + c.ox - e.clientX, dy = py + c.oy - e.clientY, d = Math.hypot(dx, dy) || 1;
      if (d > reach) continue;
      const k = (1 - d / reach) * S * 1.8;
      c.vx += (dx / d) * k; c.vy += (dy / d) * k - S * 0.5 * (1 - d / reach);
      c.boost = 1;
    }
  });

  let last = performance.now(), acc = 0;
  const FRAME = 1 / 30;
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    if (acc < FRAME - 0.004 && !reveal) return;
    const sdt = acc * (reducedMotion.matches ? 0.2 : 1);
    acc = 0;
    time += sdt;
    step(sdt);
    render(time);
  }
  requestAnimationFrame(tick);

  return {
    measure,
    setTheme(light, at) {
      const next = THEMES[light ? "light" : "dark"];
      if (next === P) return;
      if (at && !reducedMotion.matches) reveal = { x: at.x, y: at.y, from: P, start: performance.now() };
      P = next;
    },
  };
}
