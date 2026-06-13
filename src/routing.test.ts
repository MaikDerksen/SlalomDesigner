import { describe, expect, it } from "vitest";
import { analyzeRoute, autoRoute, obstacleRoutes, smoothDrawnLine } from "./routing";
import { DEFAULT_RULES } from "./rules";
import type { MapConfig, ObstacleInstance, V2 } from "./types";

const rules = DEFAULT_RULES;
const map: MapConfig = { name: "m", width: 100, height: 100 };

function custom(id: string, x: number, y: number, pylons: V2[]): ObstacleInstance {
  return {
    id,
    templateId: "my-custom-thing", // not in TEMPLATES
    name: "custom",
    x,
    y,
    rotation: 0,
    pylons: pylons.map((p) => ({ x: p.x, y: p.y })),
  };
}

describe("autoRoute", () => {
  it("returns null with fewer than 2 obstacles", () => {
    expect(autoRoute([], map, rules)).toBeNull();
    expect(autoRoute([custom("a", 10, 10, [{ x: 0, y: 0 }])], map, rules)).toBeNull();
  });
});

describe("obstacleRoutes fallback", () => {
  it("returns a single straight line for a custom obstacle without template/routes", () => {
    // wider than tall (x range > y range) -> horizontal straight line
    const o = custom("c", 20, 20, [
      { x: -2, y: 0 },
      { x: 2, y: 0 },
    ]);
    const routes = obstacleRoutes(o, rules);
    expect(routes).toHaveLength(1);
    const line = routes[0];
    expect(line).toHaveLength(2);
    // straight along x at constant world y (= obstacle y, since pylons centered on y=0)
    expect(line[0].y).toBeCloseTo(20, 9);
    expect(line[1].y).toBeCloseTo(20, 9);
    expect(line[0].x).toBeLessThan(line[1].x);
  });
});

describe("analyzeRoute crossings", () => {
  it("finds a crossing in a self-intersecting route", () => {
    // segIntersect rejects intersections within 2% of a segment endpoint and
    // only compares coarse (every-2nd-point) segments at least 4 raw points
    // apart, so the fixture uses sparse points with a clean mid-segment cross:
    // leg A goes (10,10)->(30,30); padding leads away; leg B crosses leg A.
    const pts: V2[] = [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
      { x: 32, y: 30 },
      { x: 34, y: 30 },
      { x: 36, y: 30 },
      { x: 38, y: 30 },
      { x: 40, y: 30 },
      { x: 25, y: 10 },
      { x: 17, y: 22 },
      { x: 10, y: 32 },
    ];
    const a = analyzeRoute(pts, map, rules);
    expect(a.crossings.length).toBeGreaterThanOrEqual(1);
  });

  it("finds no crossing in a simple straight route", () => {
    const pts: V2[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: 10 + i, y: 30 });
    const a = analyzeRoute(pts, map, rules);
    expect(a.crossings).toHaveLength(0);
  });
});

describe("smoothDrawnLine", () => {
  it("returns input unchanged when fewer than 3 points", () => {
    const two: V2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    const out = smoothDrawnLine(two);
    expect(out).toBe(two);
  });

  it("smooths and resamples a 3+ point line", () => {
    const raw: V2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 2, y: 0 },
    ];
    const out = smoothDrawnLine(raw);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(out[0].x)).toBe(true);
  });
});
