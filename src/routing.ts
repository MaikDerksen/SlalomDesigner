import type { MapConfig, ObstacleInstance, Rules, V2 } from "./types";
import { templateById } from "./templates";
import { bbox, dist, pointInPolygon, resample, rotatePoint, worldPylons } from "./geometry";

/**
 * Strecken-Route: verbindet die Fahrlinien der Hindernisse in Reihenfolge.
 *
 * – autoRoute(): wählt je Hindernis automatisch die Fahrtrichtung (vorwärts/
 *   rückwärts) per dynamischer Programmierung und verbindet Ausfahrt → Einfahrt
 *   mit weichen Bézier-Kurven.
 * – analyzeRoute(): prüft die Route auf kritische Kurvenradien (Kart-Wendekreis,
 *   §7.1) und Verlassen der Fahrfläche/Sperrzonen; findet Kreuzungspunkte für
 *   die Brücken-Darstellung.
 * – routeEntries(): bestimmt je Hindernis Reihenfolge + Einfahrtspunkt/-richtung
 *   entlang der Route (für Nummern-Abgleich und Einfahrts-Pfeile).
 */

export interface RouteData {
  source: "auto" | "drawn";
  points: V2[];
}

export interface RouteWarning {
  p: V2;
  kind: "radius" | "bounds" | "pylon";
  msg: string;
}

export interface RouteAnalysis {
  warnings: RouteWarning[];
  crossings: V2[];
}

export interface RouteEntry {
  obstacleId: string;
  /** Index in der Route, an dem das Hindernis erreicht wird. */
  index: number;
  p: V2;
  angleDeg: number;
}

const SAMPLE = 0.35; // m zwischen Routen-Stützpunkten

/* ---------- Fahrlinien der Hindernisse in Weltkoordinaten ---------- */

export function obstaclePath(obs: ObstacleInstance, rules: Rules): V2[] {
  const tpl = templateById(obs.templateId);
  let local: V2[];
  if (tpl) {
    local = tpl.route(rules);
  } else {
    // Eigenes Hindernis: gerade Linie entlang der längeren Bounding-Box-Achse
    const b = bbox(obs.pylons);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const ext = Math.max(w, h) / 2 + 1.5;
    local =
      w >= h
        ? [
            { x: -ext, y: 0 },
            { x: ext, y: 0 },
          ]
        : [
            { x: 0, y: -ext },
            { x: 0, y: ext },
          ];
  }
  return local.map((p) => {
    const r = rotatePoint(p, obs.rotation);
    return { x: r.x + obs.x, y: r.y + obs.y };
  });
}

function norm(v: V2): V2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function tangentAt(path: V2[], end: "start" | "end"): V2 {
  if (end === "start") return norm({ x: path[1].x - path[0].x, y: path[1].y - path[0].y });
  const n = path.length;
  return norm({ x: path[n - 1].x - path[n - 2].x, y: path[n - 1].y - path[n - 2].y });
}

/**
 * Bézier-Verbindung Ausfahrt → Einfahrt. `offset` verschiebt den Bauch der
 * Kurve seitlich – damit kann der Router um Pylonen herum ausweichen.
 */
function connector(e: V2, te: V2, s: V2, ts: V2, offset = 0): V2[] {
  const d = dist(e, s);
  const k = Math.min(5, Math.max(1.2, d / 2.6));
  const dir = norm({ x: s.x - e.x, y: s.y - e.y });
  const perp = { x: -dir.y * offset, y: dir.x * offset };
  const c1 = { x: e.x + te.x * k + perp.x, y: e.y + te.y * k + perp.y };
  const c2 = { x: s.x - ts.x * k + perp.x, y: s.y - ts.y * k + perp.y };
  const out: V2[] = [];
  const steps = Math.max(8, Math.round((d + Math.abs(offset) * 2) / SAMPLE));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * e.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * s.x,
      y: u * u * u * e.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * s.y,
    });
  }
  return out;
}

/** Mindest-Querabstand der Route zu jeder Pylone (Fuß) in m. */
const PYLON_CLEAR = 0.55;

/** Kosten einer Verbindung: Länge + Krümmung + Außerhalb- + Pylonen-Strafe. */
function connectorCost(pts: V2[], e: V2, s: V2, map: MapConfig, pylons: V2[]): number {
  let len = dist(e, pts[0] ?? s);
  let turn = 0;
  const all = [e, ...pts, s];
  for (let i = 1; i < all.length; i++) len += dist(all[i - 1], all[i]);
  for (let i = 1; i < all.length - 1; i++) {
    const a = norm({ x: all[i].x - all[i - 1].x, y: all[i].y - all[i - 1].y });
    const b = norm({ x: all[i + 1].x - all[i].x, y: all[i + 1].y - all[i].y });
    turn += Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
  }
  let outside = 0;
  for (const p of all) {
    if (!insideMap(p, map)) outside++;
  }
  return len + turn * 3 + outside * 25 + pylonPenalty(all, pylons);
}

/** Strafe, wenn die Verbindung durch/zu nah an Pylonen führt. */
function pylonPenalty(pts: V2[], pylons: V2[]): number {
  let pen = 0;
  const c2 = PYLON_CLEAR * PYLON_CLEAR;
  for (const p of pts) {
    for (const q of pylons) {
      const dx = p.x - q.x;
      if (dx > PYLON_CLEAR || dx < -PYLON_CLEAR) continue;
      const dy = p.y - q.y;
      if (dy > PYLON_CLEAR || dy < -PYLON_CLEAR) continue;
      const dd = dx * dx + dy * dy;
      if (dd < c2) pen += (PYLON_CLEAR - Math.sqrt(dd)) * 90;
    }
  }
  return pen;
}

function insideMap(p: V2, map: MapConfig): boolean {
  if (p.x < 0.2 || p.y < 0.2 || p.x > map.width - 0.2 || p.y > map.height - 0.2) return false;
  if (map.boundary && map.boundary.length >= 3 && !pointInPolygon(p, map.boundary)) return false;
  for (const zone of map.blocked ?? []) {
    if (zone.length >= 3 && pointInPolygon(p, zone)) return false;
  }
  return true;
}

/* ---------- Automatische Route ---------- */

export function autoRoute(
  obstacles: ObstacleInstance[],
  map: MapConfig,
  rules: Rules,
): RouteData | null {
  if (obstacles.length < 2) return null;

  const paths = obstacles.map((o) => resample(obstaclePath(o, rules), SAMPLE));
  const variants = paths.map((p) => [p, [...p].reverse()]);
  // Alle Pylonen-Füße: Verbindungen dürfen nicht hindurchführen
  const allPylons: V2[] = obstacles.flatMap((o) => worldPylons(o));
  const OFFSETS = [0, 2.2, -2.2, 4.5, -4.5];

  // DP über Fahrtrichtung je Hindernis
  const n = obstacles.length;
  const cost: number[][] = [
    [0, 0],
    ...Array.from({ length: n - 1 }, () => [Infinity, Infinity]),
  ];
  const from: number[][] = Array.from({ length: n }, () => [0, 0]);
  const conns: V2[][][][] = [];

  for (let i = 1; i < n; i++) {
    conns[i] = [[], []].map(() => [[], []]) as V2[][][];
    for (let dPrev = 0; dPrev < 2; dPrev++) {
      const prev = variants[i - 1][dPrev];
      const e = prev[prev.length - 1];
      const te = tangentAt(prev, "end");
      for (let dCur = 0; dCur < 2; dCur++) {
        const cur = variants[i][dCur];
        const s = cur[0];
        const ts = tangentAt(cur, "start");
        // Mehrere Ausweich-Kurven testen, beste (pylonenfreie) gewinnt
        let bestPts: V2[] = [];
        let bestC = Infinity;
        for (const off of OFFSETS) {
          const pts = connector(e, te, s, ts, off);
          const c = connectorCost(pts, e, s, map, allPylons);
          if (c < bestC) {
            bestC = c;
            bestPts = pts;
          }
        }
        conns[i][dPrev][dCur] = bestPts;
        const c = cost[i - 1][dPrev] + bestC;
        if (c < cost[i][dCur]) {
          cost[i][dCur] = c;
          from[i][dCur] = dPrev;
        }
      }
    }
  }

  // Rückverfolgung der besten Richtungs-Wahl
  const dirs: number[] = new Array(n);
  dirs[n - 1] = cost[n - 1][0] <= cost[n - 1][1] ? 0 : 1;
  for (let i = n - 1; i > 0; i--) dirs[i - 1] = from[i][dirs[i]];

  const raw: V2[] = [...variants[0][dirs[0]]];
  for (let i = 1; i < n; i++) {
    raw.push(...conns[i][dirs[i - 1]][dirs[i]]);
    raw.push(...variants[i][dirs[i]]);
  }
  // Nur gleichmäßig abtasten – NICHT glätten: Glättung würde die Fahrlinien
  // in die Pylonen-Reihen hineinziehen. Die Hindernis-Linien sind per
  // Konstruktion pylonenfrei, die Bézier-Verbindungen ohnehin glatt.
  const points = resample(raw, SAMPLE);
  return { source: "auto", points: points.map((p) => ({ x: r2(p.x), y: r2(p.y) })) };
}

/* ---------- Gezeichnete Route ---------- */

/** Freihand-Linie glätten und gleichmäßig abtasten. */
export function smoothDrawnLine(raw: V2[]): V2[] {
  if (raw.length < 3) return raw;
  let pts = resample(raw, SAMPLE);
  for (let pass = 0; pass < 3; pass++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      return {
        x: (pts[i - 1].x + 2 * p.x + pts[i + 1].x) / 4,
        y: (pts[i - 1].y + 2 * p.y + pts[i + 1].y) / 4,
      };
    });
  }
  return pts.map((p) => ({ x: r2(p.x), y: r2(p.y) }));
}

/* ---------- Analyse ---------- */

export function analyzeRoute(
  points: V2[],
  map: MapConfig,
  rules: Rules,
  obstacles: ObstacleInstance[] = [],
): RouteAnalysis {
  const warnings: RouteWarning[] = [];

  // Bereiche der Aufgaben: dort sind enge Radien reglementsbedingt in Ordnung –
  // kritisch sind Exits und Verbindungen ZWISCHEN den Aufgaben.
  const zones = obstacles.map((o) => {
    const b = bbox(o.pylons.map((p) => rotatePoint(p, o.rotation)));
    return {
      minX: o.x + b.minX - 2.2,
      maxX: o.x + b.maxX + 2.2,
      minY: o.y + b.minY - 2.2,
      maxY: o.y + b.maxY + 2.2,
    };
  });
  const inObstacle = (p: V2) =>
    zones.some((z) => p.x >= z.minX && p.x <= z.maxX && p.y >= z.minY && p.y <= z.maxY);

  // Kritische Kurvenradien (Menger-Krümmung über 3 Punkte)
  const step = 2;
  let runStart = -1;
  let runMinR = Infinity;
  const flushRun = (endIdx: number) => {
    if (runStart < 0) return;
    const mid = points[Math.floor((runStart + endIdx) / 2)];
    warnings.push({
      p: mid,
      kind: "radius",
      msg: `Kurvenradius ~${runMinR.toFixed(1)} m < Wendekreis ${rules.kartTurnRadius.toFixed(1)} m`,
    });
    runStart = -1;
    runMinR = Infinity;
  };
  for (let i = step; i < points.length - step; i++) {
    const a = points[i - step];
    const b = points[i];
    const c = points[i + step];
    const ab = dist(a, b);
    const bc = dist(b, c);
    const ca = dist(c, a);
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    const r = area < 1e-6 ? Infinity : (ab * bc * ca) / (4 * area);
    if (r < rules.kartTurnRadius * 0.92 && !inObstacle(b)) {
      if (runStart < 0) runStart = i;
      runMinR = Math.min(runMinR, r);
    } else if (runStart >= 0 && i - runStart > 2) {
      flushRun(i);
    }
  }
  flushRun(points.length - 1);

  // Fahrfläche verlassen / Sperrzone berührt
  let outStart = -1;
  for (let i = 0; i < points.length; i++) {
    const ok = insideMap(points[i], map);
    if (!ok && outStart < 0) outStart = i;
    if ((ok || i === points.length - 1) && outStart >= 0) {
      warnings.push({
        p: points[Math.floor((outStart + i) / 2)],
        kind: "bounds",
        msg: "Route verlässt die Fahrfläche / berührt eine Sperrzone",
      });
      outStart = -1;
    }
  }

  // Route führt durch Pylonen (umgeworfene Pylonen = Strafsekunden, §9.1)
  if (obstacles.length) {
    const pylons = obstacles.flatMap((o) => worldPylons(o));
    let hitStart = -1;
    for (let i = 0; i < points.length; i++) {
      const hit = pylons.some((q) => {
        const dx = points[i].x - q.x;
        const dy = points[i].y - q.y;
        return dx * dx + dy * dy < 0.3 * 0.3;
      });
      if (hit && hitStart < 0) hitStart = i;
      if ((!hit || i === points.length - 1) && hitStart >= 0) {
        warnings.push({
          p: points[Math.floor((hitStart + i) / 2)],
          kind: "pylon",
          msg: "Route führt durch Pylonen (Strafsekunden, §9.1)",
        });
        hitStart = -1;
      }
    }
  }

  // Kreuzungspunkte (für die Brücken-Darstellung)
  const crossings: V2[] = [];
  const coarse: { p: V2; idx: number }[] = [];
  for (let i = 0; i < points.length; i += 2) coarse.push({ p: points[i], idx: i });
  for (let i = 0; i < coarse.length - 1; i++) {
    for (let j = i + 4; j < coarse.length - 1; j++) {
      const hit = segIntersect(coarse[i].p, coarse[i + 1].p, coarse[j].p, coarse[j + 1].p);
      if (hit) crossings.push(hit);
    }
  }
  return { warnings, crossings };
}

function segIntersect(a: V2, b: V2, c: V2, d: V2): V2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/* ---------- Hindernis-Reihenfolge entlang der Route ---------- */

export function routeEntries(
  points: V2[],
  obstacles: ObstacleInstance[],
  rules: Rules,
): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const obs of obstacles) {
    const path = obstaclePath(obs, rules);
    const mid = path[Math.floor(path.length / 2)];
    const radius = Math.max(2.5, dist(path[0], path[path.length - 1]) / 2 + 1);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = dist(points[i], { x: obs.x, y: obs.y });
      const d2 = dist(points[i], mid);
      const dd = Math.min(d, d2);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    if (best < 0 || bestD > radius + 2) continue; // Route verfehlt das Hindernis
    // Einfahrt: rückwärts laufen, bis die Route den Hindernis-Bereich betritt
    let entry = best;
    while (entry > 0 && dist(points[entry - 1], { x: obs.x, y: obs.y }) < radius) entry--;
    const p = points[entry];
    const q = points[Math.min(points.length - 1, entry + 2)];
    entries.push({
      obstacleId: obs.id,
      index: best,
      p,
      angleDeg: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI,
    });
  }
  return entries.sort((a, b) => a.index - b.index);
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
