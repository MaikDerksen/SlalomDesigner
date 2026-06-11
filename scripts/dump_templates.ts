import { writeFileSync } from "node:fs";
import { TEMPLATES } from "../src/templates";
import { DEFAULT_RULES } from "../src/rules";

const out = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  pylons: t.build(DEFAULT_RULES),
  route: t.route(DEFAULT_RULES),
}));
writeFileSync("scripts/templates.json", JSON.stringify(out));
console.log(`dumped ${out.length} templates`);
