// A ghost's head and face, as a density field: shape space is in head radii, origin at the
// centre of the head, y down. 1 is solid, 0 empty. The head is a tall wisp of smoke, narrower
// at the crown, flowing straight into the shroud (which the scene draws, hanging from a chain
// of links so it trails the ghost's motion). The face is cut out as hollows, in one of three
// expressions.
import { clamp, smoothstep } from "./util.js";

// [eye x, eye y, eye half-length, eye half-height, eye slant, mouth y, mouth half-width, mouth half-height]
// slant > 0 droops the outer corner (sorrow), < 0 lifts it (anger)
const FACES = [
  [0.3, -0.16, 0.15, 0.26, 0.18, 0.44, 0.17, 0.22], // terror: tall eyes, a wide wail
  [0.31, -0.1, 0.21, 0.1, -0.6, 0.3, 0.09, 0.13], // anger: slanted slits, a small bitter mouth
  [0.3, -0.12, 0.2, 0.11, 0.62, 0.4, 0.075, 0.21], // sorrow: drooping eyes, a long thin moan
];

/** pose: { wave, gape, eye, lookX, lookY, reach, face (false, or 0..2), slim, asym }
 *  Returns the density; `wraithAt.hole` is how much eye or mouth was cut out at that point. */
export function wraithAt(p, x, y) {
  // head: a tall wisp, narrower toward the crown
  const taper = 1 + 0.16 * clamp(y, -1.2, 0.6);
  const hx = x / (0.8 * p.slim * taper), hy = (y + 0.12) / 1.1;
  let d = smoothstep(1.08, 0.58, Math.sqrt(hx * hx + hy * hy));
  if (y > 0.2) { // shoulders: the head flows straight into the shroud
    const sw = (0.82 + 0.2 * smoothstep(0.2, 1.1, y)) * p.slim;
    d = Math.max(d, smoothstep(sw * 1.12, sw * 0.6, Math.abs(x)) * smoothstep(1.35, 1.0, y) * 0.9);
  }

  // when it reaches out, two thin wisps of smoke lift from its sides; otherwise it has no arms
  if (p.reach > 0.15) for (let s = -1; s <= 1; s += 2) {
    const ax0 = s * 0.6, ay0 = 0.75, ax1 = s * (1.5 + 0.3 * p.reach), ay1 = 0.7 - 0.9 * p.reach + 0.1 * Math.sin(p.wave * 0.75 + s);
    const vx = ax1 - ax0, vy = ay1 - ay0, ll = vx * vx + vy * vy;
    const t = clamp(((x - ax0) * vx + (y - ay0) * vy) / ll, 0, 1);
    const qx = ax0 + vx * t - x, qy = ay0 + vy * t - y;
    const th = 0.2 * (1 - t) + 0.05;
    d = Math.max(d, smoothstep(th * 1.8, th * 0.5, Math.sqrt(qx * qx + qy * qy)) * (0.75 - 0.4 * t) * Math.min(1, p.reach * 1.5));
  }
  wraithAt.hole = 0;
  if (d < 0.01 || p.face === false) return d;
  const F = FACES[p.face | 0];
  const before = d;
  let keep = 1;

  const A = p.asym || 0;
  for (let s = -1; s <= 1; s += 2) { // eyes: hollow, uneven, and running
    const big = 1.15 * (1 + 0.22 * A * s);
    const cx = s * F[0] + p.lookX * 0.08, cy = F[1] + p.lookY * 0.06 + 0.05 * A * s;
    const ex = x - cx, ey = y - cy;
    const a = s * F[4], ca = Math.cos(a), sa = Math.sin(a);
    const u = (ex * ca + ey * sa) / (F[2] * big), v = (-ex * sa + ey * ca) / (F[3] * big * p.eye + 0.03);
    const e = u * u + v * v;
    if (e < 1.6) keep *= smoothstep(0.6, 1.6, e);
    // the hollow runs down the face, as if it were melting
    const len = 0.55 + 0.25 * A * s, t = ey / len;
    if (t > 0 && t < 1 && Math.abs(ex + 0.03 * Math.sin(ey * 9 + s)) < 0.05 * (1 - 0.6 * t)) keep *= 0.25 + 0.75 * t;
  }
  // mouth: always a hollow, gaping wider in fright, and sagging downward
  const mw = F[6] * 1.12 * (1 + 0.35 * p.gape), mh = F[7] * 1.2 * (1 + 0.5 * p.gape);
  const mx = (x - p.lookX * 0.05) / mw, my = (y - F[5]) / mh;
  const m = mx * mx + my * my;
  if (m < 1.6) keep *= smoothstep(0.6, 1.6, m);
  const mt = (y - F[5] - mh * 0.6) / 0.5;
  if (mt > 0 && mt < 1 && Math.abs(x - p.lookX * 0.05) < mw * 0.45 * (1 - mt)) keep *= 0.3 + 0.7 * mt;

  d *= keep;
  // how much of a solid face was cut away here: a theme may paint these holes dark
  wraithAt.hole = before > 0.3 ? (1 - keep) * before : 0;
  return d;
}
