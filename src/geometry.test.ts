import { describe, expect, it } from "vitest";
import {
  bbox,
  closestPair,
  distPointToSegment,
  distToPolygonEdge,
  minPointDist,
  pointInPolygon,
  rdpSimplify,
  rotatePoint,
  round2,
} from "./geometry";
import type { V2 } from "./types";

describe("pointInPolygon", () => {
  const square: V2[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];

  it("detects a point inside", () => {
    expect(pointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
  });

  it("detects a point outside", () => {
    expect(pointInPolygon({ x: 5, y: 2 }, square)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 2 }, square)).toBe(false);
  });

  it("handles a concave notch (point in the notch is outside)", () => {
    // C-shape with a notch cut into the right side
    const cShape: V2[] = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 0, y: 6 },
    ];
    // inside the solid left part
    expect(pointInPolygon({ x: 1, y: 3 }, cShape)).toBe(true);
    // inside the notch region (x between 2 and 6, y between 2 and 4) -> outside
    expect(pointInPolygon({ x: 4, y: 3 }, cShape)).toBe(false);
  });
});

describe("distPointToSegment", () => {
  const a: V2 = { x: 0, y: 0 };
  const b: V2 = { x: 10, y: 0 };

  it("projects onto the interior of the segment", () => {
    expect(distPointToSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 9);
  });

  it("clamps to an endpoint when the projection is beyond it", () => {
    // x=15 is beyond b at x=10 -> nearest is b, distance = hypot(5,4)
    expect(distPointToSegment({ x: 15, y: 4 }, a, b)).toBeCloseTo(Math.hypot(5, 4), 9);
  });

  it("returns a finite distance (no NaN) for a zero-length segment", () => {
    const d = distPointToSegment({ x: 3, y: 4 }, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(Number.isNaN(d)).toBe(false);
    expect(d).toBeCloseTo(Math.hypot(2, 3), 9);
  });
});

describe("closestPair & minPointDist", () => {
  const a: V2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  const b: V2[] = [
    { x: 5, y: 0 },
    { x: 1.5, y: 0 },
  ];

  it("agree on the minimal distance", () => {
    const cp = closestPair(a, b);
    expect(cp.d).toBeCloseTo(minPointDist(a, b), 9);
    expect(cp.d).toBeCloseTo(0.5, 9);
  });

  it("closestPair returns the actual closest endpoints", () => {
    const cp = closestPair(a, b);
    expect(cp.p).toEqual({ x: 1, y: 0 });
    expect(cp.q).toEqual({ x: 1.5, y: 0 });
  });
});

describe("rdpSimplify", () => {
  it("collapses collinear points to the two endpoints", () => {
    const line: V2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ];
    const out = rdpSimplify(line, 0.01);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("returns input of length < 2 unchanged (but as a copy)", () => {
    const one: V2[] = [{ x: 1, y: 2 }];
    const out = rdpSimplify(one, 0.5);
    expect(out).toEqual(one);
    expect(out).not.toBe(one);
  });

  it("keeps a corner that exceeds epsilon", () => {
    const v: V2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 0 },
    ];
    const out = rdpSimplify(v, 0.5);
    expect(out).toHaveLength(3);
  });
});

describe("distToPolygonEdge", () => {
  it("includes the closing edge", () => {
    const square: V2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    // Point near the closing edge (from last vertex back to first: x=0 edge)
    // sits at x=0.5 -> nearest edge is the left (closing) edge, distance 0.5
    expect(distToPolygonEdge({ x: 0.5, y: 2 }, square)).toBeCloseTo(0.5, 9);
  });
});

describe("rotatePoint", () => {
  it("rotates (1,0) by 90 degrees to approximately (0,1)", () => {
    const r = rotatePoint({ x: 1, y: 0 }, 90);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(1, 9);
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
    expect(round2(-0.001)).toBe(-0);
  });
});

describe("bbox", () => {
  it("computes the bounding box of a point set", () => {
    const b = bbox([
      { x: -1, y: 2 },
      { x: 3, y: -4 },
      { x: 0, y: 0 },
    ]);
    expect(b).toEqual({ minX: -1, minY: -4, maxX: 3, maxY: 2 });
  });
});
