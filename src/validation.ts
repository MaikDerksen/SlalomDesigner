import type { MapConfig, ObstacleInstance, Rules, V2, ValidationFlags } from "./types";
import { bbox, distToPolygonEdge, minPointDist, pointInPolygon, worldPylons } from "./geometry";

/**
 * Regelprüfung nach §7.2 / §8:
 * – Abstand zwischen Aufgaben min. 4 m (zu nah → rot)
 * – Aufgabe muss innerhalb der Fahrfläche inkl. Randabstand liegen (→ rot)
 * – Sperrzonen (markierte Hindernisse) dürfen nicht berührt werden (→ rot)
 * – Abstand > maxTaskGap zur nächsten Aufgabe → Hinweis (gelb)
 */

/** Liegen alle Pylonen-Füße regelkonform auf der Fahrfläche? */
export function boundsOk(points: V2[], map: MapConfig, rules: Rules): boolean {
  const m = rules.edgeMargin;
  const half = rules.pylonBase / 2;

  for (const p of points) {
    // Rechteckgrenze gilt immer (Bildrand = Ende der bekannten Fläche)
    if (p.x - half < 0 || p.y - half < 0 || p.x + half > map.width || p.y + half > map.height)
      return false;

    if (map.boundary && map.boundary.length >= 3) {
      if (!pointInPolygon(p, map.boundary)) return false;
      if (distToPolygonEdge(p, map.boundary) - half < m) return false;
    } else {
      if (p.x - half < m || p.y - half < m || p.x + half > map.width - m || p.y + half > map.height - m)
        return false;
    }

    if (map.blocked) {
      for (const zone of map.blocked) {
        if (zone.length < 3) continue;
        if (pointInPolygon(p, zone)) return false;
        if (distToPolygonEdge(p, zone) - half < m) return false;
      }
    }
  }
  return true;
}

export function validate(
  obstacles: ObstacleInstance[],
  map: MapConfig,
  rules: Rules,
): Map<string, ValidationFlags> {
  const result = new Map<string, ValidationFlags>();
  const points = obstacles.map((o) => worldPylons(o));
  const boxes = points.map((p) => bbox(p));

  for (let i = 0; i < obstacles.length; i++) {
    let nearest = Infinity;
    for (let j = 0; j < obstacles.length; j++) {
      if (i === j) continue;
      // Bounding-Box-Vorfilter: nur rechnen, wenn Annäherung möglich ist
      const a = boxes[i];
      const b = boxes[j];
      const gapX = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
      const gapY = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
      const lower = Math.hypot(gapX, gapY);
      if (lower >= nearest) continue;
      const d = minPointDist(points[i], points[j]);
      if (d < nearest) nearest = d;
    }

    result.set(obstacles[i].id, {
      tooClose: nearest < rules.minTaskGap - 1e-9,
      outOfBounds: !boundsOk(points[i], map, rules),
      isolated: obstacles.length > 1 && nearest > rules.maxTaskGap + 1e-9,
      nearestDist: nearest,
    });
  }
  return result;
}
