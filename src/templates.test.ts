import { describe, expect, it } from "vitest";
import { TEMPLATES, templateById } from "./templates";
import { bbox } from "./geometry";
import { DEFAULT_RULES } from "./rules";

const rules = DEFAULT_RULES;

describe("TEMPLATES build/route invariants", () => {
  for (const tpl of TEMPLATES) {
    describe(tpl.id, () => {
      const pylons = tpl.build(rules);
      const route = tpl.route(rules);

      it("builds at least 2 pylons with finite coordinates", () => {
        expect(pylons.length).toBeGreaterThanOrEqual(2);
        for (const p of pylons) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
        }
      });

      it("is centered on the origin (pylon bbox)", () => {
        // finalize() centers, then rounds every coordinate to 2 decimals
        // (round2). That rounding can shift each extreme by up to 0.005, so
        // |minX+maxX| can be as large as ~0.01 — tolerate the cm rounding.
        const b = bbox(pylons);
        expect(Math.abs(b.minX + b.maxX)).toBeLessThanOrEqual(0.0101);
        expect(Math.abs(b.minY + b.maxY)).toBeLessThanOrEqual(0.0101);
      });

      it("has a route of length >= 2", () => {
        expect(route.length).toBeGreaterThanOrEqual(2);
      });
    });
  }
});

describe("tor template", () => {
  it("produces exactly 2 pylons", () => {
    const tor = templateById("tor")!;
    expect(tor.build(rules)).toHaveLength(2);
  });
});

describe("templateById", () => {
  it("finds a known template", () => {
    expect(templateById("zielgasse")?.id).toBe("zielgasse");
  });

  it("returns undefined for an unknown id", () => {
    expect(templateById("does-not-exist")).toBeUndefined();
  });
});
