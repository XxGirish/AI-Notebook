import type { PointSample } from "../domain/notebook";

type Point = Pick<PointSample, "x" | "y">;

/**
 * Capacitive pen digitizers (the pens of most Windows laptops and tablets)
 * report positions with an error that repeats with the sensor grid: each axis
 * is pulled toward the nearest electrode, about every 30 screen px. Along a
 * horizontal or vertical line the pull only slides the pen along the stroke,
 * so it cannot be seen. Along a diagonal both axes are pulled at once, and a
 * straight line comes out as a staircase. On the device this was reported
 * from, lines swung ±3–4 px sideways every 38–47 px.
 *
 * Handwriting has features of the same size, so a plain smoothing filter
 * cannot remove the wobble without also eating small loops
 * (docs/decisions/0008-digitizer-wobble.md). This filter acts only where the
 * stroke, seen through a window wider than the wobble, is a smooth curve plus
 * deviations no bigger than the wobble's:
 *
 * - Local quadratic fits along arc length at four widths. Where a fit leaves
 *   no more residual than the wobble does, the sample moves onto it, and the
 *   widest width that still fits wins, so long lines come out straight. A
 *   quadratic follows constant curvature, so arcs and circles do not shrink.
 * - Loops and letters leave far more residual at these widths and stay
 *   exactly as sampled.
 * - Corners of 65° or more split the stroke, so an L, V or arrowhead keeps its
 *   point. The measured wobble turns the stroke by at most about 37°.
 * - Stroke ends and corners are pinned: windows narrow toward them, so the
 *   drawn tip stays on the newest sample and never trails the pen.
 *
 * Distances are screen px, converted with the camera scale at capture: the
 * wobble belongs to the screen, not the page.
 */

/**
 * Gaussian widths of the fits, screen px. The narrowest already averages out
 * a whole wobble period; narrower windows mistook parts of letters written
 * 24 px and larger for wobble.
 */
const WIDTHS = [28, 48, 84, 128];
/** RMS fit residual, screen px, up to which a window counts as smooth. The wobble leaves at most ~2.5. */
const SMOOTH_RESIDUAL = 2.4;
/** RMS fit residual at which smoothing is off entirely. Handwriting leaves 3.5 and more. */
const SHAPED_RESIDUAL = 3.4;
/**
 * Estimated error, screen px, of a fit that follows curvature: a quadratic
 * under a Gaussian of width σ misplaces a circle of curvature κ by about
 * σ⁴κ³/8. Up to the first value the fit is trusted, from the second not at
 * all. It keeps loops and bowls that the residual alone would let through.
 */
const SMALL_BIAS = 0.2;
const LARGE_BIAS = 0.6;
/** Arm length, screen px, of the chords that measure turning at a corner. */
const CORNER_ARM = 14;
const CORNER_COS = Math.cos((65 * Math.PI) / 180);
/** Near a stroke end or corner a window is at most this many times the distance to it. */
const END_TAPER = 1.5;
/** Fits are computed on a regular grid along the stroke with this many nodes per width. */
const NODES_PER_WIDTH = 8;

type Grid = {
  width: number;
  start: number;
  step: number;
  x: Float64Array;
  y: Float64Array;
  weight: Float64Array;
};

type Fit = { x: number; y: number; residual: number; curvature: number };

/**
 * Removes digitizer wobble from a stroke's samples. `screenScale` is screen px
 * per document unit when the stroke was drawn (the camera scale). Only x and y
 * change; the first and last samples are returned exactly as they were.
 */
export function removeDigitizerWobble<T extends Point>(points: T[], screenScale = 1): T[] {
  if (points.length < 4) return points;
  const unit = 1 / screenScale;
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(lengths[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const result = points.slice();
  const cuts = [0, ...findCorners(points, lengths, CORNER_ARM * unit), points.length - 1];
  for (let index = 1; index < cuts.length; index += 1) {
    steadyRun(points, lengths, cuts[index - 1], cuts[index], unit, result);
  }
  return result;
}

function steadyRun<T extends Point>(points: T[], lengths: number[], first: number, last: number, unit: number, result: T[]) {
  const start = lengths[first];
  const end = lengths[last];
  const grids: Grid[] = [];
  for (const width of WIDTHS) {
    // A window has to cover more than two widths of stroke to judge its shape.
    if (end - start <= 2 * width * unit) break;
    grids.push(fitGrid(points, lengths, first, last, width * unit, unit));
  }

  for (let index = first + 1; index < last; index += 1) {
    const at = lengths[index];
    const reach = END_TAPER * Math.min(at - start, end - at);
    let { x, y } = points[index];
    for (const grid of grids) {
      const position = (at - grid.start) / grid.step;
      const node = Math.min(grid.x.length - 2, Math.max(0, Math.floor(position)));
      const t = Math.min(1, Math.max(0, position - node));
      const weight = grid.weight[node] + (grid.weight[node + 1] - grid.weight[node]) * t;
      if (weight <= 0) break;
      x += weight * (grid.x[node] + (grid.x[node + 1] - grid.x[node]) * t - x);
      y += weight * (grid.y[node] + (grid.y[node + 1] - grid.y[node]) * t - y);
      // Narrowed by an end: a wider grid would only repeat this fit, more coarsely.
      if (grid.width >= reach) break;
    }
    if (x !== points[index].x || y !== points[index].y) result[index] = { ...points[index], x, y };
  }
}

/**
 * Fits of one width at evenly spaced nodes along a run: where the fitted curve
 * is, and how much to trust it there (0 = keep the samples, 1 = use the fit).
 */
function fitGrid(points: Point[], lengths: number[], first: number, last: number, width: number, unit: number): Grid {
  const start = lengths[first];
  const end = lengths[last];
  const count = Math.max(2, Math.ceil(((end - start) * NODES_PER_WIDTH) / width));
  const step = (end - start) / count;
  const nodesX = new Float64Array(count + 1);
  const nodesY = new Float64Array(count + 1);
  let segment = first;
  for (let node = 0; node <= count; node += 1) {
    const at = start + node * step;
    while (segment < last - 1 && lengths[segment + 1] < at) segment += 1;
    const span = lengths[segment + 1] - lengths[segment];
    const t = span > 0 ? Math.min(1, Math.max(0, (at - lengths[segment]) / span)) : 0;
    nodesX[node] = points[segment].x + (points[segment + 1].x - points[segment].x) * t;
    nodesY[node] = points[segment].y + (points[segment + 1].y - points[segment].y) * t;
  }

  const grid: Grid = { width, start, step, x: new Float64Array(count + 1), y: new Float64Array(count + 1), weight: new Float64Array(count + 1) };
  const smooth = SMOOTH_RESIDUAL * unit;
  const shaped = SHAPED_RESIDUAL * unit;
  const kernel = gaussian(width / step);
  for (let node = 0; node <= count; node += 1) {
    const at = start + node * step;
    const fit = fitAt(nodesX, nodesY, node, width / step, kernel);
    const reach = END_TAPER * Math.min(at - start, end - at);
    // Narrow the fit symmetrically toward an end, so the end itself stays put.
    const narrowed = reach >= width ? fit : reach >= step ? fitAt(nodesX, nodesY, node, reach / step) : undefined;
    grid.x[node] = narrowed?.x ?? nodesX[node];
    grid.y[node] = narrowed?.y ?? nodesY[node];
    if (!fit) continue;
    const support = Math.min(end, at + 3 * width) - Math.max(start, at - 3 * width);
    const bias = (width ** 4 * fit.curvature ** 3) / 8;
    const trust = clamp01((shaped - fit.residual) / (shaped - smooth))
      * clamp01((support - 2 * width) / width)
      * clamp01((LARGE_BIAS * unit - bias) / ((LARGE_BIAS - SMALL_BIAS) * unit));
    grid.weight[node] = trust * trust * (3 - 2 * trust);
  }
  return grid;
}

/**
 * Gaussian-weighted least-squares quadratic through the nodes around `center`,
 * `sigma` in nodes. Returns its value and curvature at the center, and the
 * weighted RMS distance of the nodes from it.
 */
function fitAt(nodesX: Float64Array, nodesY: Float64Array, center: number, sigma: number, kernel = gaussian(sigma)): Fit | undefined {
  const lastNode = nodesX.length - 1;
  const from = Math.max(0, center - kernel.length + 1);
  const to = Math.min(lastNode, center + kernel.length - 1);
  const originX = nodesX[center];
  const originY = nodesY[center];
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let x0 = 0, x1 = 0, x2 = 0, y0 = 0, y1 = 0, y2 = 0, squares = 0;
  for (let node = from; node <= to; node += 1) {
    const v = (node - center) / sigma;
    // Trapezoid weights: the grid's end nodes stand for half a step of stroke.
    const w = kernel[Math.abs(node - center)] * (node === 0 || node === lastNode ? 0.5 : 1);
    const dx = nodesX[node] - originX;
    const dy = nodesY[node] - originY;
    const v2 = v * v;
    s0 += w; s1 += w * v; s2 += w * v2; s3 += w * v2 * v; s4 += w * v2 * v2;
    x0 += w * dx; x1 += w * dx * v; x2 += w * dx * v2;
    y0 += w * dy; y1 += w * dy * v; y2 += w * dy * v2;
    squares += w * (dx * dx + dy * dy);
  }
  // Normal equations [[s0 s1 s2] [s1 s2 s3] [s2 s3 s4]] · c = b, solved by cofactors.
  const c11 = s2 * s4 - s3 * s3;
  const c12 = s2 * s3 - s1 * s4;
  const c13 = s1 * s3 - s2 * s2;
  const c22 = s0 * s4 - s2 * s2;
  const c23 = s1 * s2 - s0 * s3;
  const c33 = s0 * s2 - s1 * s1;
  const determinant = s0 * c11 + s1 * c12 + s2 * c13;
  if (!(determinant > 1e-9 * s0 * s2 * s4)) return undefined;
  const solve = (b0: number, b1: number, b2: number) => [
    (c11 * b0 + c12 * b1 + c13 * b2) / determinant,
    (c12 * b0 + c22 * b1 + c23 * b2) / determinant,
    (c13 * b0 + c23 * b1 + c33 * b2) / determinant,
  ];
  const cx = solve(x0, x1, x2);
  const cy = solve(y0, y1, y2);
  // For a least-squares fit, residual = Σw·|d|² − c·b.
  const residual = squares - (cx[0] * x0 + cx[1] * x1 + cx[2] * x2) - (cy[0] * y0 + cy[1] * y1 + cy[2] * y2);
  // Curvature of (c0 + c1·v + c2·v²) at v = 0; it does not depend on how v is scaled.
  const speed = Math.hypot(cx[1], cy[1]);
  const curvature = speed > 0 ? (2 * Math.abs(cx[1] * cy[2] - cy[1] * cx[2])) / speed ** 3 : Infinity;
  return { x: originX + cx[0], y: originY + cy[0], residual: Math.sqrt(Math.max(0, residual) / s0), curvature };
}

/**
 * Samples where the stroke turns by the corner angle or more between the
 * chords `arm` behind and `arm` ahead of it; sharpest first, so of several
 * candidates within an arm of each other only the sharpest is kept.
 */
function findCorners(points: Point[], lengths: number[], arm: number): number[] {
  const total = lengths[lengths.length - 1];
  const candidates: { index: number; cos: number }[] = [];
  let behind = 0;
  let ahead = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const at = lengths[index];
    if (at < arm || at > total - arm) continue;
    while (lengths[behind + 1] < at - arm) behind += 1;
    while (ahead < points.length - 2 && lengths[ahead + 1] < at + arm) ahead += 1;
    const back = pointAt(points, lengths, behind, at - arm);
    const front = pointAt(points, lengths, ahead, at + arm);
    const ax = points[index].x - back.x, ay = points[index].y - back.y;
    const bx = front.x - points[index].x, by = front.y - points[index].y;
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    if (cos <= CORNER_COS) candidates.push({ index, cos });
  }
  candidates.sort((a, b) => a.cos - b.cos);
  const corners: number[] = [];
  for (const { index } of candidates) {
    // `corners` stays sorted; only its neighbours at the insertion point can be within an arm.
    let low = 0;
    let high = corners.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (corners[middle] < index) low = middle + 1;
      else high = middle;
    }
    const before = corners[low - 1];
    const after = corners[low];
    if (before !== undefined && lengths[index] - lengths[before] <= arm) continue;
    if (after !== undefined && lengths[after] - lengths[index] <= arm) continue;
    corners.splice(low, 0, index);
  }
  return corners;
}

/** Gaussian weights at whole-node offsets 0…3σ. */
function gaussian(sigma: number): Float64Array {
  const kernel = new Float64Array(Math.ceil(3 * sigma) + 1);
  for (let offset = 0; offset < kernel.length; offset += 1) kernel[offset] = Math.exp(-0.5 * (offset / sigma) ** 2);
  return kernel;
}

function pointAt(points: Point[], lengths: number[], segment: number, at: number): Point {
  const span = lengths[segment + 1] - lengths[segment];
  const t = span > 0 ? Math.min(1, Math.max(0, (at - lengths[segment]) / span)) : 0;
  return {
    x: points[segment].x + (points[segment + 1].x - points[segment].x) * t,
    y: points[segment].y + (points[segment + 1].y - points[segment].y) * t,
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
