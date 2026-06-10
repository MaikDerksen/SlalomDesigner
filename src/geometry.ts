import type { Pylon, V2 } from "./types";

export const deg2rad = (d: number) => (d * Math.PI) / 180;

export function rotatePoint(p: V2, deg: number): V2 {
  const a = deg2rad(deg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function dist(a: V2, b: V2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Pylonen eines Hindernisses in Weltkoordinaten. */
export function worldPylons(
  obs: { x: number; y: number; rotation: number; pylons: Pylon[] },
): V2[] {
  return obs.pylons.map((p) => {
    const r = rotatePoint(p, obs.rotation);
    return { x: r.x + obs.x, y: r.y + obs.y };
  });
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(points: V2[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Kürzester Abstand zwischen zwei Punktmengen (Fuß zu Fuß, §7.2:
 * "Alle Maße werden von Fuß zu Fuß der Pylonen gemessen").
 */
export function minPointDist(a: V2[], b: V2[]): number {
  let best = Infinity;
  for (const p of a) {
    for (const q of b) {
      const d = dist(p, q);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Punktpaar mit kürzestem Abstand (für die Abstandsanzeige beim Ziehen). */
export function closestPair(a: V2[], b: V2[]): { p: V2; q: V2; d: number } {
  let best = { p: a[0], q: b[0], d: Infinity };
  for (const p of a) {
    for (const q of b) {
      const d = dist(p, q);
      if (d < best.d) best = { p, q, d };
    }
  }
  return best;
}

/* ---------- Pfad-Helfer für Gassen-Hindernisse ---------- */

/** Polyline fein neu abtasten (Schrittweite step). */
export function resample(pts: V2[], step: number): V2[] {
  if (pts.length < 2) return pts.slice();
  const out: V2[] = [pts[0]];
  let prev = pts[0];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i];
    let segLen = dist(prev, cur);
    while (carry + segLen >= step) {
      const t = (step - carry) / segLen;
      const np = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(np);
      prev = np;
      segLen = dist(prev, cur);
      carry = 0;
    }
    carry += segLen;
    prev = cur;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Punkte im Abstand `gap` entlang einer Polyline. */
export function spaced(pts: V2[], gap: number): V2[] {
  if (pts.length < 2) return pts.slice();
  const out: V2[] = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    acc += d;
    if (acc >= gap - 1e-9) {
      out.push(pts[i]);
      acc = 0;
    }
  }
  return out;
}

/** Polyline um d versetzen (positive d = links der Laufrichtung). */
export function offsetPath(pts: V2[], d: number): V2[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ x: pts[i].x - (dy / len) * d, y: pts[i].y + (dx / len) * d });
  }
  return out;
}

/** Kreisbogen abtasten (Winkel in Grad). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 48): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = deg2rad(a0 + ((a1 - a0) * i) / steps);
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/**
 * Gassen-Hindernis: Pylonenreihen beidseitig einer Mittellinie,
 * lichte Breite `laneW`, Pylonenabstand `gap`.
 */
export function channel(center: V2[], laneW: number, gap: number, base: number): Pylon[] {
  const fine = resample(center, 0.05);
  const half = laneW / 2 + base / 2;
  const left = spaced(offsetPath(fine, half), gap);
  const right = spaced(offsetPath(fine, -half), gap);
  return [...left, ...right].map((p) => ({ x: round2(p.x), y: round2(p.y) }));
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Pylonen um den gemeinsamen Schwerpunkt zentrieren. */
export function centerPylons(pylons: Pylon[]): Pylon[] {
  if (!pylons.length) return pylons;
  const b = bbox(pylons);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return pylons.map((p) => ({ ...p, x: round2(p.x - cx), y: round2(p.y - cy) }));
}

/* ---------- Polygon-Helfer (Fahrflächen-Maske, Sperrzonen) ---------- */

export function pointInPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function distPointToSegment(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolygonEdge(p: V2, poly: V2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** Ramer-Douglas-Peucker-Vereinfachung einer Polylinie/eines Polygons. */
export function rdpSimplify(points: V2[], epsilon: number): V2[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distPointToSegment(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
