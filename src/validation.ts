import type { MapConfig, ObstacleInstance, Rules, ValidationFlags } from "./types";
import { bbox, minPointDist, worldPylons } from "./geometry";

/**
 * Regelprüfung nach §7.2 / §8:
 * – Abstand zwischen Aufgaben min. 4 m (zu nah → rot)
 * – Aufgabe muss innerhalb der Fahrfläche inkl. Randabstand liegen (→ rot)
 * – Abstand > maxTaskGap zur nächsten Aufgabe → Hinweis (gelb)
 */
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

    const m = rules.edgeMargin;
    const half = rules.pylonBase / 2;
    const out =
      boxes[i].minX - half < m ||
      boxes[i].minY - half < m ||
      boxes[i].maxX + half > map.width - m ||
      boxes[i].maxY + half > map.height - m;

    result.set(obstacles[i].id, {
      tooClose: nearest < rules.minTaskGap - 1e-9,
      outOfBounds: out,
      isolated: obstacles.length > 1 && nearest > rules.maxTaskGap + 1e-9,
      nearestDist: nearest,
    });
  }
  return result;
}
