import { describe, expect, it } from "vitest";
import { boundsOk, validate } from "./validation";
import { DEFAULT_RULES } from "./rules";
import type { MapConfig, ObstacleInstance, V2 } from "./types";

const rules = DEFAULT_RULES;
const HALF = rules.pylonBase / 2; // 0.14
const M = rules.edgeMargin; // 1

/** A simple obstacle instance with pylons given in LOCAL coords. */
function obs(id: string, x: number, y: number, pylons: V2[], rotation = 0): ObstacleInstance {
  return {
    id,
    templateId: "tor",
    name: "test",
    x,
    y,
    rotation,
    pylons: pylons.map((p) => ({ x: p.x, y: p.y })),
  };
}

describe("boundsOk (rectangular map)", () => {
  const map: MapConfig = { name: "m", width: 20, height: 20 };

  it("returns false when a foot pokes past the width", () => {
    // point sits exactly on the right edge; +half pushes it past width
    const pts: V2[] = [{ x: 20, y: 10 }];
    expect(boundsOk(pts, map, rules)).toBe(false);
  });

  it("returns true for a point well inside respecting the edge margin", () => {
    // must be >= M + half from each edge: 1.14 .. 18.86
    const pts: V2[] = [{ x: 5, y: 5 }];
    expect(boundsOk(pts, map, rules)).toBe(true);
  });

  it("returns false when inside the rectangle but inside the edge margin", () => {
    // x - half = 0.5 - 0.14 = 0.36 < 1 (margin) -> false
    const pts: V2[] = [{ x: 0.5, y: 10 }];
    expect(boundsOk(pts, map, rules)).toBe(false);
  });
});

describe("boundsOk (boundary polygon)", () => {
  // A boundary polygon smaller than the rectangle.
  const boundary: V2[] = [
    { x: 2, y: 2 },
    { x: 18, y: 2 },
    { x: 18, y: 18 },
    { x: 2, y: 18 },
  ];
  const map: MapConfig = { name: "m", width: 20, height: 20, boundary };

  it("returns true for a point inside the polygon with clearance", () => {
    expect(boundsOk([{ x: 10, y: 10 }], map, rules)).toBe(true);
  });

  it("returns false for a point outside the boundary polygon", () => {
    expect(boundsOk([{ x: 1, y: 10 }], map, rules)).toBe(false);
  });

  it("returns false for a point inside the polygon but too close to its edge", () => {
    // distance to polygon edge = 0.1; 0.1 - half < margin -> false
    expect(boundsOk([{ x: 2.1, y: 10 }], map, rules)).toBe(false);
  });
});

describe("boundsOk (blocked zone)", () => {
  const blocked: V2[][] = [
    [
      { x: 8, y: 8 },
      { x: 12, y: 8 },
      { x: 12, y: 12 },
      { x: 8, y: 12 },
    ],
  ];
  const map: MapConfig = { name: "m", width: 20, height: 20, blocked };

  it("returns false for a point inside a blocked zone", () => {
    expect(boundsOk([{ x: 10, y: 10 }], map, rules)).toBe(false);
  });

  it("returns false for a point too close to a blocked zone edge", () => {
    // 0.1 from the zone edge -> within margin -> false
    expect(boundsOk([{ x: 7.9, y: 10 }], map, rules)).toBe(false);
  });

  it("returns true for a point far from the blocked zone and the borders", () => {
    expect(boundsOk([{ x: 4, y: 4 }], map, rules)).toBe(true);
  });
});

describe("validate", () => {
  const map: MapConfig = { name: "m", width: 100, height: 100 };

  it("returns an empty Map for an empty obstacle list", () => {
    const r = validate([], map, rules);
    expect(r.size).toBe(0);
  });

  it("flags both obstacles as tooClose when nearer than minTaskGap", () => {
    // single-pylon obstacles 2 m apart < minTaskGap (4)
    const a = obs("a", 10, 10, [{ x: 0, y: 0 }]);
    const b = obs("b", 12, 10, [{ x: 0, y: 0 }]);
    const r = validate([a, b], map, rules);
    expect(r.get("a")!.tooClose).toBe(true);
    expect(r.get("b")!.tooClose).toBe(true);
  });

  it("does NOT flag tooClose at exactly minTaskGap + eps", () => {
    // tooClose uses (nearest < minTaskGap - 1e-9). At distance 4 it must be false.
    const a = obs("a", 10, 10, [{ x: 0, y: 0 }]);
    const b = obs("b", 14, 10, [{ x: 0, y: 0 }]);
    const r = validate([a, b], map, rules);
    expect(r.get("a")!.nearestDist).toBeCloseTo(4, 9);
    expect(r.get("a")!.tooClose).toBe(false);
    expect(r.get("b")!.tooClose).toBe(false);
  });

  it("flags isolated when farther than maxTaskGap", () => {
    // 50 m apart > maxTaskGap (10)
    const a = obs("a", 10, 10, [{ x: 0, y: 0 }]);
    const b = obs("b", 60, 10, [{ x: 0, y: 0 }]);
    const r = validate([a, b], map, rules);
    expect(r.get("a")!.isolated).toBe(true);
    expect(r.get("b")!.isolated).toBe(true);
    // far apart but not too close
    expect(r.get("a")!.tooClose).toBe(false);
  });

  it("never marks a single obstacle as isolated", () => {
    const a = obs("a", 10, 10, [{ x: 0, y: 0 }]);
    const r = validate([a], map, rules);
    expect(r.get("a")!.isolated).toBe(false);
    expect(r.get("a")!.nearestDist).toBe(Infinity);
  });
});
