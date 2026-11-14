// A wraith, as a density field: shape space is in head radii, origin at the centre of the
// head, y down. 1 is solid, 0 empty; the face is cut out as holes so it reads as hollow.
import { clamp, smoothstep } from "./util.js";

/**
 * pose: { lean, wave, gape, eye, lookX, lookY, reach, face, arms, slim, tail }
 * Returns the density; the feature at that point (0 none, 1 eye socket centre, 2 tear) is left in `wraithAt.feature`.
 */
export function wraithAt(p, x, y) {
  // the shroud trails behind the motion and ripples, more the further down it hangs
  const k = clamp(y / 3, 0, 1.4);
  const sx = x + p.lean * k * k * 0.9 - Math.sin(p.wave - y * 1.5) * 0.22 * k;

  // head: a long skull-like oval
  const hx = sx / (0.78 * p.slim), hy = (y + 0.05) / 1.02;
  let d = smoothstep(1.15, 0.55, Math.sqrt(hx * hx + hy * hy));

  // shroud: falls from the head, widens, then tears into ragged strands
  if (y > 0.2) {
    const w = (0.74 + 0.32 * smoothstep(0.3, 1.2, y) - 0.7 * smoothstep(1.3, 3.8 * p.tail, y)) * p.slim; // shoulders, then a narrowing tail
    const across = Math.abs(sx) / w;
    const strand = 0.5 + 0.5 * Math.cos(sx * 5.2 + Math.sin(p.wave * 0.75) * 0.6);
    const end = (2.6 + 1.4 * strand * strand) * p.tail;
    const body = smoothstep(1.12, 0.6, across) * smoothstep(end, end - 1.0 * p.tail, y) * (1 - 0.35 * smoothstep(1.4, 3.4 * p.tail, y));
    d = Math.max(d, body);
  }

  // arms: long thin wisps from the shoulders, hanging and reaching
  if (p.arms) for (let s = -1; s <= 1; s += 2) {
    const ax0 = s * 0.75, ay0 = 0.75;
    const ax1 = s * (1.45 + 0.35 * p.reach), ay1 = 2.0 - 0.9 * p.reach + 0.15 * Math.sin(p.wave * 0.75 + s);
    const vx = ax1 - ax0, vy = ay1 - ay0, ll = vx * vx + vy * vy;
    const t = clamp(((sx - ax0) * vx + (y - ay0) * vy) / ll, 0, 1);
    const qx = ax0 + vx * t - sx, qy = ay0 + vy * t - y;
    const th = 0.2 * (1 - t) + 0.05;
    d = Math.max(d, smoothstep(th * 1.8, th * 0.5, Math.sqrt(qx * qx + qy * qy)) * (0.95 - 0.3 * t));
  }
  wraithAt.feature = 0;
  if (d < 0.01) return 0;

  // eye sockets: tall, tilted so they droop toward the outside
  let feature = 0;
  if (!p.face) { wraithAt.feature = 0; return d; }
  for (let s = -1; s <= 1; s += 2) {
    const ex = sx - (s * 0.32 + p.lookX * 0.08), ey = y - (-0.12 + p.lookY * 0.06);
    const a = s * 0.32, ca = Math.cos(a), sa = Math.sin(a);
    const u = (ex * ca + ey * sa) / 0.19, v = (-ex * sa + ey * ca) / (0.32 * p.eye + 0.04);
    const e = u * u + v * v;
    if (e < 1.8) d *= smoothstep(0.5, 1.8, e);
    if (e < 0.18 && p.eye > 0.3) feature = 1;
    // a dark streak running down from each eye
    const tx = Math.abs(ex), ty = ey;
    if (ty > 0.2 && ty < 0.85 && tx < 0.045 + 0.02 * Math.sin(ty * 9)) { d *= 0.35; feature = feature || 2; }
  }
  // mouth: a long, slack, open oval
  const mx = (sx - p.lookX * 0.05) / (0.11 + 0.06 * p.gape), my = (y - 0.55) / (0.2 + 0.18 * p.gape);
  const m = mx * mx + my * my;
  if (m < 1.8) d *= smoothstep(0.5, 1.8, m);

  wraithAt.feature = feature;
  return d;
}

export const WRAITH = { top: -1.2, bottom: 4.0, half: 2.0 }; // bottom scales with pose.tail
