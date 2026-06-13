import { describe, expect, it } from "vitest";
import { generateTrack } from "./generator";
import { validate } from "./validation";
import { DEFAULT_RULES } from "./rules";
import type { GeneratorOptions, MapConfig } from "./types";

const rules = DEFAULT_RULES;
// Reasonably large map so generation reliably succeeds.
const map: MapConfig = { name: "m", width: 60, height: 40 };

const baseOpts: GeneratorOptions = {
  mode: "exact",
  exact: 4,
  min: 3,
  max: 5,
  allowed: ["tor", "spurgasse", "schikane", "wechseltor"],
  withZielgasse: false,
};

const ITER = 20;

describe("generateTrack invariants (loop)", () => {
  it("returns the exact count in exact mode and passes validation each time", () => {
    let succeeded = 0;
    for (let k = 0; k < ITER; k++) {
      const track = generateTrack(map, rules, baseOpts);
      if (track === null) continue; // tolerate occasional failure on a small map
      succeeded++;
      expect(track).toHaveLength(baseOpts.exact);

      // Cross-check with the same validator/rules: no tooClose, no outOfBounds.
      const flags = validate(track, map, rules);
      for (const o of track) {
        const f = flags.get(o.id)!;
        expect(f.tooClose).toBe(false);
        expect(f.outOfBounds).toBe(false);
      }
    }
    expect(succeeded).toBeGreaterThan(0);
  });

  it("appends the zielgasse as the last task (count + 1)", () => {
    const opts: GeneratorOptions = { ...baseOpts, withZielgasse: true };
    let succeeded = 0;
    for (let k = 0; k < ITER; k++) {
      const track = generateTrack(map, rules, opts);
      if (track === null) continue;
      succeeded++;
      expect(track).toHaveLength(opts.exact + 1);
      expect(track[track.length - 1].templateId).toBe("zielgasse");
      // exactly one zielgasse in the chain
      expect(track.filter((o) => o.templateId === "zielgasse")).toHaveLength(1);
    }
    expect(succeeded).toBeGreaterThan(0);
  });

  it("respects a restricted allowed set", () => {
    const opts: GeneratorOptions = { ...baseOpts, allowed: ["tor"] };
    let succeeded = 0;
    for (let k = 0; k < ITER; k++) {
      const track = generateTrack(map, rules, opts);
      if (track === null) continue;
      succeeded++;
      for (const o of track) expect(o.templateId).toBe("tor");
    }
    expect(succeeded).toBeGreaterThan(0);
  });

  it("returns null when the allowed pool is empty", () => {
    const opts: GeneratorOptions = { ...baseOpts, allowed: [] };
    expect(generateTrack(map, rules, opts)).toBeNull();
  });

  it("returns null when only zielgasse is allowed (pool excludes zielgasse)", () => {
    // The pool is built from allowed templates minus 'zielgasse', so it is empty.
    const opts: GeneratorOptions = { ...baseOpts, allowed: ["zielgasse"] };
    expect(generateTrack(map, rules, opts)).toBeNull();
  });
});
