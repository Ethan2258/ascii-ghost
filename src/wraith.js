// A ghost, as a density field: shape space is in head radii, origin at the centre of the
// head, y down. 1 is solid, 0 empty. The head is the brightest, most solid part; the shroud
// below it thins into smoke, and the face is cut out as holes so it reads as hollow.
import { clamp, smoothstep } from "./util.js";

/** pose: { lean, wave, gape, eye, lookX, lookY, reach, face, arms, slim, tail, noBody }
 *  Returns the density; `wraithAt.hole` is how much eye or mouth was cut out at that point. */
export function wraithAt(p, x, y) {
  // the shroud trails behind the motion and ripples, more the further down it hangs
  const k = clamp(y / 3, 0, 1.4);
  const sx = x + p.lean * k * k * 0.9 - Math.sin(p.wave - y * 1.5) * 0.22 * k;

  // head: round and solid
  const hx = sx / (0.86 * p.slim), hy = (y + 0.02) / 0.98;
  let d = smoothstep(1.08, 0.62, Math.sqrt(hx * hx + hy * hy));

  // shroud: shoulders, then a narrowing tail torn into strands; fainter than the head
  if (y > 0.25 && !p.noBody) { // (the scene draws the shroud along a spine instead)
    const w = (0.8 + 0.28 * smoothstep(0.3, 1.2, y) - 0.72 * smoothstep(1.3, 3.8 * p.tail, y)) * p.slim;
    const across = Math.abs(sx) / w;
    const strand = 0.5 + 0.5 * Math.cos(sx * 5.2 + Math.sin(p.wave * 0.75) * 0.6);
    const end = (2.6 + 1.4 * strand * strand) * p.tail;
    const fade = 0.78 - 0.4 * smoothstep(0.7, 3.2 * p.tail, y);
    const body = smoothstep(1.12, 0.6, across) * smoothstep(end, end - 1.0 * p.tail, y) * fade;
    d = Math.max(d, body);
  }

  // arms: long thin wisps from the shoulders, hanging and reaching
  if (p.arms) for (let s = -1; s <= 1; s += 2) {
    const ax0 = s * 0.78, ay0 = 0.8;
    const ax1 = s * (1.45 + 0.35 * p.reach), ay1 = 2.0 - 0.9 * p.reach + 0.15 * Math.sin(p.wave * 0.75 + s);
    const vx = ax1 - ax0, vy = ay1 - ay0, ll = vx * vx + vy * vy;
    const t = clamp(((sx - ax0) * vx + (y - ay0) * vy) / ll, 0, 1);
    const qx = ax0 + vx * t - sx, qy = ay0 + vy * t - y;
    const th = 0.19 * (1 - t) + 0.05;
    d = Math.max(d, smoothstep(th * 1.8, th * 0.5, Math.sqrt(qx * qx + qy * qy)) * (0.7 - 0.3 * t));
  }
  wraithAt.hole = 0;
  if (d < 0.01 || !p.face) return d;
  const before = d;
  let keep = 1;

  // eye sockets: big, set apart, tipped very slightly down at the outside
  for (let s = -1; s <= 1; s += 2) {
    const ex = sx - (s * 0.36 + p.lookX * 0.08), ey = y - (-0.1 + p.lookY * 0.06);
    const a = s * 0.14, ca = Math.cos(a), sa = Math.sin(a);
    const u = (ex * ca + ey * sa) / 0.21, v = (-ex * sa + ey * ca) / (0.33 * p.eye + 0.04);
    const e = u * u + v * v;
    if (e < 1.7) keep *= smoothstep(0.55, 1.7, e);
  }
  // mouth: a tall, dark, open hole
  const mx = (sx - p.lookX * 0.05) / (0.12 + 0.05 * p.gape), my = (y - 0.5) / (0.2 + 0.16 * p.gape);
  const m = mx * mx + my * my;
  if (m < 1.7) keep *= smoothstep(0.55, 1.7, m);
  d *= keep;
  // how much of a solid face was cut away here: a light theme paints these holes dark
  wraithAt.hole = before > 0.3 ? (1 - keep) * before : 0;
  return d;
}

export const WRAITH = { top: -1.2, bottom: 4.0, half: 2.0 }; // bottom scales with pose.tail
