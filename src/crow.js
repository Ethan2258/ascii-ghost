// A crow overhead, seen from below: unit space is one half-wingspan, the bird faces +x,
// y is across the wings. Flapping foreshortens the wings (`span`) and pulls the tips
// forward (`sweep`); `bank` makes one wing a little shorter than the other in a turn.

// One wing in glide pose, for y > 0: leading edge, five rounded primaries, then the
// secondaries back to the body. Each primary is [tip x, tip y, notch x, notch y].
const PRIMARIES = [
  [0.0, 1.0, -0.075, 0.885],
  [-0.115, 0.975, -0.15, 0.835],
  [-0.215, 0.92, -0.215, 0.775],
  [-0.295, 0.845, -0.265, 0.705],
  [-0.345, 0.755, -0.29, 0.63],
];

function wing(ctx, s, span, sweep) {
  // y out along the wing is foreshortened; the further out, the more the tip swings forward
  const X = (x, y) => x + sweep * y * y;
  const Y = (y) => s * y * span;
  ctx.moveTo(X(0.12, 0.04), Y(0.04));
  ctx.quadraticCurveTo(X(0.24, 0.22), Y(0.22), X(0.2, 0.47), Y(0.47)); // arm, bulging forward
  ctx.quadraticCurveTo(X(0.15, 0.78), Y(0.78), X(0.05, 0.93), Y(0.93)); // hand
  let px = 0.05, py = 0.93;
  for (const [tx, ty, nx, ny] of PRIMARIES) {
    // round each feather end: control point pushed out past the tip
    const mx = (px + nx) / 2, my = (py + ny) / 2;
    const cx = tx + (tx - mx) * 0.55, cy = ty + (ty - my) * 0.55;
    ctx.quadraticCurveTo(X(cx, cy), Y(cy), X(nx, ny), Y(ny));
    px = nx; py = ny;
  }
  // secondaries: a softly scalloped trailing edge back to the body
  ctx.quadraticCurveTo(X(-0.31, 0.55), Y(0.55), X(-0.25, 0.44), Y(0.44));
  ctx.quadraticCurveTo(X(-0.26, 0.3), Y(0.3), X(-0.19, 0.2), Y(0.2));
  ctx.quadraticCurveTo(X(-0.17, 0.09), Y(0.09), X(-0.1, 0.05), Y(0.05));
  ctx.closePath();
}

function body(ctx) {
  // symmetric outline: beak, head, neck, body, rounded wedge tail
  const side = [
    [0.36, 0.028, 0.31, 0.04], // beak to head
    [0.27, 0.075, 0.2, 0.06], // head to neck
    [0.06, 0.11, -0.18, 0.065], // body
    [-0.3, 0.08, -0.44, 0.13], // tail flares
  ];
  ctx.moveTo(0.44, 0);
  for (const [cx, cy, x, y] of side) ctx.quadraticCurveTo(cx, cy, x, y);
  ctx.quadraticCurveTo(-0.53, 0, -0.44, -0.13);
  for (let i = side.length - 1; i >= 0; i--) {
    const [cx, cy] = side[i];
    const [x, y] = i > 0 ? side[i - 1].slice(2) : [0.44, 0];
    ctx.quadraticCurveTo(cx, -cy, x, -y);
  }
  ctx.closePath();
}

/** Fill a crow; the caller has translated and rotated to the bird and scaled to its half-wingspan. */
export function drawCrow(ctx, span, sweep, bank = 0) {
  ctx.beginPath();
  wing(ctx, 1, span * (1 - 0.18 * bank), sweep);
  wing(ctx, -1, span * (1 + 0.18 * bank), sweep);
  body(ctx);
  ctx.fill("nonzero");
}

/** Wing pose for a flap phase: fast downstroke, slower recovery; `amp` 0 is a glide. */
export function flapPose(phase, amp) {
  const p = phase / (Math.PI * 2);
  const f = p - Math.floor(p);
  // warp time so 40% of the cycle is the downstroke
  const w = f < 0.4 ? (f / 0.4) * 0.5 : 0.5 + ((f - 0.4) / 0.6) * 0.5;
  const c = Math.cos(w * Math.PI * 2); // 1 = wings raised, -1 = wings lowered
  const fore = Math.abs(c); // raised or lowered wings both look shorter from below
  return {
    span: 1 - amp * (0.5 * fore + 0.08),
    sweep: amp * (0.22 * fore) + (1 - amp) * 0.02,
  };
}
