import type { GeneratorOptions, MapConfig, ObstacleInstance, Pylon, Rules } from "./types";
import { TEMPLATES } from "./templates";
import { bbox, minPointDist, rotatePoint, uid, worldPylons } from "./geometry";
import { boundsOk } from "./validation";

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
  customTemplates: { id: string; name: string; pylons: Pylon[]; baseTemplateId?: string }[] = [],
): ObstacleInstance[] | null {
  // Vereins-Overrides ersetzen die offiziellen Vorlagen
  const withOverride = (tplId: string, fallback: { id: string; name: string; build: (r: Rules) => Pylon[] }) => {
    const ov = customTemplates.find((c) => c.baseTemplateId === tplId);
    return ov ? { id: ov.id, name: ov.name, build: () => ov.pylons } : fallback;
  };
  const pool = [
    ...TEMPLATES.filter((t) => opts.allowed.includes(t.id) && t.id !== "zielgasse").map((t) =>
      withOverride(t.id, t),
    ),
    ...customTemplates
      .filter((t) => opts.allowed.includes(t.id) && !t.baseTemplateId)
      .map((t) => ({ id: t.id, name: t.name, build: () => t.pylons })),
  ];
  if (!pool.length) return null;

  const count =
    opts.mode === "exact"
      ? opts.exact
      : opts.min + Math.floor(Math.random() * (opts.max - opts.min + 1));

  const zielTpl = withOverride("zielgasse", TEMPLATES.find((t) => t.id === "zielgasse")!);

  for (let attempt = 0; attempt < 30; attempt++) {
    const placed = tryGenerate(map, rules, pool, count, opts.withZielgasse, zielTpl);
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
  zielTpl: { id: string; name: string; build: (r: Rules) => Pylon[] },
): ObstacleInstance[] | null {
  const placed: ObstacleInstance[] = [];
  const placedPoints: { x: number; y: number }[][] = [];
  const m = rules.edgeMargin;

  const totalCount = count + (withZiel ? 1 : 0);
  let backtracks = 0;

  for (let i = 0; i < totalCount; i++) {
    // Die sperrige Zielgasse zuerst auf die leere Fläche setzen;
    // die Kette wird am Ende umgedreht, damit sie die letzte Aufgabe ist.
    const isZiel = withZiel && i === 0;
    const tpl = isZiel ? zielTpl : pool[Math.floor(Math.random() * pool.length)];

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
      // gleiche Prüfung wie validation.ts (Polygon-Grenze, Sperrzonen, Rand)
      if (!boundsOk(world, map, rules)) continue;

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
    if (!ok) {
      // Sackgasse: letzte Aufgabe zurücknehmen und neu versuchen
      if (i <= 1 || backtracks >= 12) return null;
      backtracks++;
      placed.pop();
      placedPoints.pop();
      i -= 2; // i-1 erneut platzieren (Schleife inkrementiert wieder)
    }
  }
  // Kette umdrehen → Zielgasse ist die letzte Aufgabe
  if (withZiel) placed.reverse();
  return placed;
}
