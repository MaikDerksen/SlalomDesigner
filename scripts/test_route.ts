import { writeFileSync } from "node:fs";
import { generateTrack } from "../src/generator";
import { autoRoute, analyzeRoute, routeEntries } from "../src/routing";
import { worldPylons } from "../src/geometry";
import { DEFAULT_RULES } from "../src/rules";
import { TEMPLATES } from "../src/templates";
import type { MapConfig } from "../src/types";

const map: MapConfig = { name: "Test", width: 60, height: 40 };
const allowed = TEMPLATES.filter((t) => t.id !== "zielgasse").map((t) => t.id);

const obstacles = generateTrack(map, DEFAULT_RULES, {
  mode: "exact",
  exact: 8,
  min: 8,
  max: 8,
  allowed,
  withZielgasse: true,
});
if (!obstacles) {
  console.error("Generierung fehlgeschlagen");
  process.exit(1);
}

const route = autoRoute(obstacles, map, DEFAULT_RULES);
if (!route) {
  console.error("Route fehlgeschlagen");
  process.exit(1);
}
const analysis = analyzeRoute(route.points, map, DEFAULT_RULES, obstacles);
const entries = routeEntries(route.points, obstacles, DEFAULT_RULES);

writeFileSync(
  "scripts/route_test.json",
  JSON.stringify({
    map,
    obstacles: obstacles.map((o, i) => ({
      n: i + 1,
      name: o.name,
      x: o.x,
      y: o.y,
      pylons: worldPylons(o),
      lying: o.pylons.map((p) => !!p.lying),
    })),
    route: route.points,
    warnings: analysis.warnings,
    crossings: analysis.crossings,
    entries: entries.map((e) => ({ ...e, n: obstacles.findIndex((o) => o.id === e.obstacleId) + 1 })),
  }),
);

console.log(
  `Aufgaben: ${obstacles.length} | Routenpunkte: ${route.points.length} | ` +
    `Warnungen: ${analysis.warnings.length} | Kreuzungen: ${analysis.crossings.length}`,
);
console.log("Reihenfolge entlang Route:", entries.map((e) => obstacles.findIndex((o) => o.id === e.obstacleId) + 1).join(" → "));
console.log("Aufgaben:", obstacles.map((o, i) => `${i + 1}=${o.name}`).join(", "));
