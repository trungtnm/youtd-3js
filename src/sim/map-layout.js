// Grid and path layout shared by the simulation and the 3D world.

export const TILE = 2;
export const COLS = 28;
export const ROWS = 20;
export const MAP_W = COLS * TILE;
export const MAP_D = ROWS * TILE;

// Tile-centre -> world position (map is centred on the origin, x = cols, z = rows).
export const tileToWorld = (c, r) => ({ x: (c - COLS / 2 + 0.5) * TILE, z: (r - ROWS / 2 + 0.5) * TILE });
export const worldToTile = (x, z) => ({ c: Math.floor(x / TILE + COLS / 2), r: Math.floor(z / TILE + ROWS / 2) });

// Ground route: a four-lane serpentine with three U-turns. Corners are in tile coordinates.
const GROUND_CORNERS = [
  [-2, 2], [24, 2], [24, 7], [3, 7], [3, 12], [24, 12], [24, 17], [2, 17],
];
// Air route: flyers cut diagonally across the lanes.
const AIR_CORNERS = [
  [-2, 2], [23, 4.5], [4, 9.5], [23, 14.5], [2, 17],
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
const LC = COLS - 1, LR = ROWS - 1;
export const MAP_CORNERS = ['0,0', `${LC},${LR}`, `${LC},0`, `0,${LR}`];
export const BLOCKED_TILES = new Set([
  '0,0', '1,0', '0,1', `${LC},${LR}`, `${LC - 1},${LR}`, `${LC},${LR - 1}`, `${LC},0`, `${LC - 1},0`, `0,${LR}`, `1,${LR}`, `0,${LR - 1}`,
]);

export const isBuildable = (c, r) =>
  c >= 0 && r >= 0 && c < COLS && r < ROWS && !PATH_TILES.has(`${c},${r}`) && !BLOCKED_TILES.has(`${c},${r}`);

export const SPAWN = tileToWorld(-2, 2);
export const PORTAL = tileToWorld(...GROUND_CORNERS.at(-1));
// Direction of travel on the last stretch, and the crystal just past the path's end.
const lastSeg = GROUND_ROUTE.segs.at(-1);
export const PORTAL_DIR = { x: lastSeg.dx, z: lastSeg.dz };
export const NEXUS = { x: PORTAL.x + PORTAL_DIR.x * 1.5, z: PORTAL.z + PORTAL_DIR.z * 1.5 };
// The last stretch before the crystal: a creep that enters it has leaked. Towers no
// longer reach it there; the view plays its attack on the crystal and its end.
export const LEAK_ZONE = 2 * TILE;
