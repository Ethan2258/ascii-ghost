// A ghost's head, face and sleeves, as a density field: shape space is in head radii, origin at
// the centre of the head, y down. 1 is solid, 0 empty. The face is two hollow eyes cut out of
// the sheet (and a small round mouth only when it is frightened). The scene draws the shroud
// below the head separately, hanging from a chain of links so it trails the ghost's motion.
import { clamp, smoothstep } from "./util.js";

/** pose: { wave, gape, eye, lookX, lookY, reach, face, arms, slim }
 *  Returns the density; `wraithAt.hole` is how much eye or mouth was cut out at that point. */
export function wraithAt(p, x, y) {
  // head: round and soft, widening into the shoulders so there is no neck
  const hx = x / (0.9 * p.slim), hy = (y + 0.02) / 0.96;
  let d = smoothstep(1.08, 0.6, Math.sqrt(hx * hx + hy * hy));
  if (y > 0.2) { // shoulders: the head flows straight into the shroud
    const sw = (0.86 + 0.18 * smoothstep(0.2, 1.1, y)) * p.slim;
    d = Math.max(d, smoothstep(sw * 1.12, sw * 0.62, Math.abs(x)) * smoothstep(1.35, 1.0, y) * 0.92);
  }

  // sleeves: wide, soft and drooping, cloth rather than limbs; they lift when it reaches out
  if (p.arms) for (let s = -1; s <= 1; s += 2) {
    const ax0 = s * 0.62, ay0 = 0.62;
    const ax1 = s * (1.12 + 0.28 * p.reach), ay1 = 1.3 - 0.5 * p.reach + 0.08 * Math.sin(p.wave * 0.75 + s);
    const vx = ax1 - ax0, vy = ay1 - ay0, ll = vx * vx + vy * vy;
    const t = clamp(((x - ax0) * vx + (y - ay0) * vy) / ll, 0, 1);
    const qx = ax0 + vx * t - x, qy = ay0 + vy * t - y;
    const th = 0.34 * (1 - t) + 0.13; // broad at the shoulder, still broad at the cuff
    // the cuff hangs in a soft scallop
    const cuff = t > 0.75 ? 0.06 * Math.sin((qx * s) * 18 + p.wave) : 0;
    d = Math.max(d, smoothstep(th * 1.25 + cuff, th * 0.55, Math.sqrt(qx * qx + qy * qy)) * (0.78 - 0.18 * t));
  }
  wraithAt.hole = 0;
  if (d < 0.01 || !p.face) return d;
  const before = d;
  let keep = 1;

  // eyes: two round, hollow, slightly-too-far-apart dark eyes, set a little low
  for (let s = -1; s <= 1; s += 2) {
    const ex = (x - (s * 0.33 + p.lookX * 0.09)) / 0.165;
    const ey = (y - (-0.02 + p.lookY * 0.06)) / (0.215 * p.eye + 0.035);
    const e = ex * ex + ey * ey;
    if (e < 1.6) keep *= smoothstep(0.6, 1.6, e);
  }
  // mouth: nothing at rest; a small round "o" when frightened
  if (p.gape > 0.25) {
    const g = (p.gape - 0.25) / 0.75;
    const mx = (x - p.lookX * 0.05) / (0.06 + 0.06 * g), my = (y - 0.42) / (0.05 + 0.11 * g);
    const m = mx * mx + my * my;
    if (m < 1.6) keep *= smoothstep(0.6, 1.6, m);
  }
  d *= keep;
  // how much of a solid face was cut away here: a theme may paint these holes dark
  wraithAt.hole = before > 0.3 ? (1 - keep) * before : 0;
  return d;
}
