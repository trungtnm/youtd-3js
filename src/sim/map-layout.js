// Grid and path layout shared by the simulation and the 3D world.

export const TILE = 2;
export const COLS = 30;
export const ROWS = 16;
export const MAP_W = COLS * TILE;
export const MAP_D = ROWS * TILE;

// Tile-centre -> world position (map is centred on the origin, x = cols, z = rows).
export const tileToWorld = (c, r) => ({ x: (c - COLS / 2 + 0.5) * TILE, z: (r - ROWS / 2 + 0.5) * TILE });
export const worldToTile = (x, z) => ({ c: Math.floor(x / TILE + COLS / 2), r: Math.floor(z / TILE + ROWS / 2) });

// Ground route: a compact three-lane serpentine. Corners are in tile coordinates.
const GROUND_CORNERS = [
  [-2, 2], [26, 2], [26, 7], [3, 7], [3, 12], [27, 12],
];
// Air route: flyers cut diagonally across the lanes.
const AIR_CORNERS = [
  [-2, 2], [25, 4.5], [4, 9.5], [27, 12],
];

function buildRoute(corners) {
  const pts = corners.map(([c, r]) => tileToWorld(c, r));
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    segs.push({ a, b, len, start: total, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len });
    total += len;
  }
  return { pts, segs, length: total };
}

export const GROUND_ROUTE = buildRoute(GROUND_CORNERS);
export const AIR_ROUTE = buildRoute(AIR_CORNERS);

export function sampleRoute(route, d, out = {}) {
  const segs = route.segs;
  let s = segs[segs.length - 1];
  if (d <= 0) s = segs[0];
  else {
    for (let i = 0; i < segs.length; i++) {
      if (d < segs[i].start + segs[i].len) { s = segs[i]; break; }
    }
  }
  const t = Math.max(0, Math.min(s.len, d - s.start));
  out.x = s.a.x + s.dx * t;
  out.z = s.a.z + s.dz * t;
  out.dx = s.dx;
  out.dz = s.dz;
  return out;
}

// Tiles occupied by the ground path (towers cannot be built here).
export const PATH_TILES = new Set();
for (let i = 0; i < GROUND_CORNERS.length - 1; i++) {
  const [c0, r0] = GROUND_CORNERS[i];
  const [c1, r1] = GROUND_CORNERS[i + 1];
  const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0));
  for (let k = 0; k <= steps; k++) {
    const c = Math.round(c0 + ((c1 - c0) * k) / steps);
    const r = Math.round(r0 + ((r1 - r0) * k) / steps);
    PATH_TILES.add(`${c},${r}`);
  }
}

// Decorative rocky tiles at the map corners.
export const BLOCKED_TILES = new Set([
  '0,0', '1,0', '0,1', '29,15', '28,15', '29,14', '29,0', '28,0', '0,15', '1,15', '0,14',
]);

export const isBuildable = (c, r) =>
  c >= 0 && r >= 0 && c < COLS && r < ROWS && !PATH_TILES.has(`${c},${r}`) && !BLOCKED_TILES.has(`${c},${r}`);

export const SPAWN = tileToWorld(-2, 2);
export const PORTAL = tileToWorld(27, 12);
