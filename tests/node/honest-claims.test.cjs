// DAT-HEADLINE-PRE2025-1 (2026-10-27). Run: node --test tests/node/honest-claims.test.cjs
// The home headline total (web/data/daily_rollup.json totals.jobs) sums events from 2023-01 onward (about 48 percent are dated before 2025),
// and the methodology page said events below 0.4 confidence are excluded while the collector gate is MIN_CONFIDENCE = 0.5
// (scripts/run_toll.py:26,658). Copy now matches the code; thresholds in code are unchanged.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const R = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(R, f), "utf8");
const code = read("scripts/run_toll.py");
const gate = (code.match(/^MIN_CONFIDENCE\s*=\s*([0-9.]+)/m) || [])[1];
test("collector gate is 0.5 (page copy must match)", () => { assert.strictEqual(gate, "0.5"); });
test("methodology states the code threshold, not 0.4", () => {
  const m = read("web/methodology/index.html");
  assert.doesNotMatch(m, /below 0\.4 are typically excluded/);
  assert.match(m, new RegExp("below " + gate.replace(".", "\\.") + "\\."));
});
test("methodology discloses historical entries in the headline total", () => {
  const m = read("web/methodology/index.html");
  assert.match(m, /January 2023/);
  assert.match(m, /before 2025/);
});
test("home hero label states the window of the headline total", () => {
  assert.match(read("web/index.html"), /jobs displaced since January 2023/);
});
