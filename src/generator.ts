import type { GeneratorOptions, MapConfig, ObstacleInstance, Pylon, Rules } from "./types";
import { TEMPLATES } from "./templates";
import { bbox, minPointDist, rotatePoint, uid, worldPylons } from "./geometry";

/**
 * Zufallsgenerator für Strecken.
 * Platziert Aufgaben nacheinander so, dass jede neue Aufgabe
 * 4–10 m (konfigurierbar) von der vorherigen entfernt ist und zu allen
 * anderen den Mindestabstand einhält (§7.2).
 */
export function generateTrack(
  map: MapConfig,
  rules: Rules,
  opts: GeneratorOptions,
  customTemplates: { id: string; name: string; pylons: Pylon[] }[] = [],
): ObstacleInstance[] | null {
  const pool = [
    ...TEMPLATES.filter((t) => opts.allowed.includes(t.id) && t.id !== "zielgasse"),
    ...customTemplates
      .filter((t) => opts.allowed.includes(t.id))
      .map((t) => ({ id: t.id, name: t.name, ref: "custom", build: () => t.pylons })),
  ];
  if (!pool.length) return null;

  const count =
    opts.mode === "exact"
      ? opts.exact
      : opts.min + Math.floor(Math.random() * (opts.max - opts.min + 1));

  for (let attempt = 0; attempt < 30; attempt++) {
    const placed = tryGenerate(map, rules, pool, count, opts.withZielgasse);
    if (placed) return placed;
  }
  return null;
}

function tryGenerate(
  map: MapConfig,
  rules: Rules,
  pool: { id: string; name: string; build: (r: Rules) => Pylon[] }[],
  count: number,
  withZiel: boolean,
): ObstacleInstance[] | null {
  const placed: ObstacleInstance[] = [];
  const placedPoints: { x: number; y: number }[][] = [];
  const m = rules.edgeMargin;

  const totalCount = count + (withZiel ? 1 : 0);

  for (let i = 0; i < totalCount; i++) {
    const isZiel = withZiel && i === totalCount - 1;
    const tpl = isZiel
      ? TEMPLATES.find((t) => t.id === "zielgasse")!
      : pool[Math.floor(Math.random() * pool.length)];

    let ok = false;
    for (let tries = 0; tries < 250 && !ok; tries++) {
      const rotation = Math.floor(Math.random() * 24) * 15;
      const pylons = tpl.build(rules);
      const local = pylons.map((p) => rotatePoint(p, rotation));
      const b = bbox(local);

      let x: number, y: number;
      if (placed.length === 0) {
        x = m - b.minX + Math.random() * Math.max(0.1, map.width - 2 * m - (b.maxX - b.minX));
        y = m - b.minY + Math.random() * Math.max(0.1, map.height - 2 * m - (b.maxY - b.minY));
      } else {
        // Anker im Abstand minTaskGap..maxTaskGap von der vorherigen Aufgabe
        const prev = placedPoints[placedPoints.length - 1];
        const anchor = prev[Math.floor(Math.random() * prev.length)];
        const dir = Math.random() * 2 * Math.PI;
        const span = rules.maxTaskGap - rules.minTaskGap;
        const d = rules.minTaskGap + 0.3 + Math.random() * Math.max(0.1, span - 0.6);
        x = anchor.x + Math.cos(dir) * d - (b.minX + b.maxX) / 2;
        y = anchor.y + Math.sin(dir) * d - (b.minY + b.maxY) / 2;
      }

      const inst: ObstacleInstance = {
        id: uid("obs"),
        templateId: tpl.id,
        name: tpl.name,
        x,
        y,
        rotation,
        pylons,
      };
      const world = worldPylons(inst);
      const wb = bbox(world);
      // gleiche Grenzprüfung wie validation.ts: inkl. halber Bodenplatte
      const half = rules.pylonBase / 2;
      if (
        wb.minX - half < m ||
        wb.minY - half < m ||
        wb.maxX + half > map.width - m ||
        wb.maxY + half > map.height - m
      )
        continue;

      // Mindestabstand zu allen, Maximalabstand zur vorherigen Aufgabe
      let valid = true;
      for (let j = 0; j < placedPoints.length; j++) {
        const d = minPointDist(world, placedPoints[j]);
        if (d < rules.minTaskGap) {
          valid = false;
          break;
        }
        if (j === placedPoints.length - 1 && d > rules.maxTaskGap) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;

      placed.push(inst);
      placedPoints.push(world);
      ok = true;
    }
    if (!ok) return null;
  }
  return placed;
}
