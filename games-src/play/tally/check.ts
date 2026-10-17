// Tally checks under Node: node <bundle> <path to web/play/cards.json>
// The card pool is the real ledger subset; every check reads it, so a regenerated pool is re-checked.
import { readFileSync } from "fs";
import { runChecks } from "../../PlayKit/check";
import {
  type Pool, type LevelDef, MAIN_IDS, DECK_SIZE, MAX_MISSES, mainLevel, dailyLevel, newRun, place, rightSlot, fits,
  isOver, passed, finalScore, marks, useCheck, scaleBand, ledgerRoles,
} from "./model";

const pool: Pool = JSON.parse(readFileSync(process.argv[2] || "web/play/cards.json", "utf8"));

function solve(level: LevelDef, wrong = 0): ReturnType<typeof newRun> {
  const run = newRun(level);
  let w = wrong;
  while (!isOver(level, run)) {
    const c = level.deck[run.next];
    const good = rightSlot(run.ledger, c);
    const slot = w > 0 && !fits(run.ledger, good === 0 ? run.ledger.length : 0, c) ? (good === 0 ? run.ledger.length : 0) : good;
    if (slot !== good) w--;
    place(level, run, slot);
  }
  return run;
}

function sorted(run: ReturnType<typeof newRun>): boolean {
  for (let i = 1; i < run.ledger.length; i++) if (run.ledger[i - 1].roles < run.ledger[i].roles) return false;
  return true;
}

const fails = runChecks("Tally (dailyaitoll.com/play)", [
  { name: "pool has cards", run: () => ({ ok: pool.cards.length >= 30, detail: pool.cards.length + " cards" }) },
  {
    name: "every card has a positive count, a source link and a causality label",
    run: () => {
      const bad = pool.cards.filter((c) => !(c.roles > 0) || !/^https?:\/\//.test(c.url) || ["direct", "contributing", "inferred"].indexOf(c.causality) < 0);
      return { ok: bad.length === 0, detail: bad.length + " bad cards" };
    },
  },
  {
    name: "no masked headline or excerpt shows the card's own count",
    run: () => {
      const leak = pool.cards.filter((c) => {
        const s = String(c.roles), comma = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        const re = new RegExp("(^|[^0-9,.])(" + s + "|" + comma.replace(/,/g, "\\,") + ")([^0-9,]|$)");
        return re.test(c.masked) || re.test(c.excerpt);
      });
      return { ok: leak.length === 0, detail: leak.map((c) => c.id).join(" ") || "none" };
    },
  },
  {
    name: "main level uses all hand-picked entries with distinct counts",
    run: () => {
      const L = mainLevel(pool);
      const ids = [L.anchor.id].concat(L.deck.map((c) => c.id));
      const counts: { [k: number]: boolean } = {};
      [L.anchor].concat(L.deck).forEach((c) => (counts[c.roles] = true));
      return { ok: ids.join() === MAIN_IDS.join() && Object.keys(counts).length === DECK_SIZE + 1, detail: ids.length + " cards, " + Object.keys(counts).length + " distinct counts" };
    },
  },
  {
    name: "reference play passes main with 3 marks and a sorted ledger",
    run: () => {
      const L = mainLevel(pool), r = solve(L);
      const m = marks(L, r).filter((x) => x.got).length;
      return { ok: passed(L, r) && m === 3 && sorted(r) && finalScore(L, r) === 10 * 100 + 20 * 45 + 100, detail: "score " + finalScore(L, r) + ", marks " + m + ", ledger " + ledgerRoles(r) + " roles" };
    },
  },
  {
    name: "two misses still pass (2 marks lost at most), ledger stays sorted",
    run: () => {
      const L = mainLevel(pool), r = solve(L, 2);
      return { ok: passed(L, r) && r.misses === 2 && sorted(r) && !marks(L, r)[1].got, detail: "misses " + r.misses + ", score " + finalScore(L, r) };
    },
  },
  {
    name: "three misses end the run (must fail)",
    run: () => {
      const L = mainLevel(pool), r = solve(L, MAX_MISSES);
      return { ok: !passed(L, r) && isOver(L, r) && r.misses === MAX_MISSES && marks(L, r).every((x) => !x.got), detail: "placed " + r.next + ", misses " + r.misses };
    },
  },
  {
    name: "scale check costs points and forfeits the no-checks mark; one per card",
    run: () => {
      const L = mainLevel(pool), run = newRun(L);
      const a = useCheck(run), b = useCheck(run);
      return { ok: a && !b && run.score === -50 && run.checks === 1, detail: "score " + run.score };
    },
  },
  {
    name: "scale bands",
    run: () => ({ ok: scaleBand(8) === "fewer than 100 roles" && scaleBand(100) === "100 to 999 roles" && scaleBand(21000) === "10,000 roles or more", detail: "8, 100, 21000" }),
  },
  {
    name: "daily level: same for everyone on a day, distinct counts, changes day to day, solvable for 60 days",
    run: () => {
      let bad = 0, same = 0;
      for (let d = 20743; d < 20803; d++) {
        const A = dailyLevel(pool, d), B = dailyLevel(pool, d), N = dailyLevel(pool, d + 1);
        const all = [A.anchor].concat(A.deck);
        const counts: { [k: number]: boolean } = {};
        all.forEach((c) => (counts[c.roles] = true));
        if (JSON.stringify(A) !== JSON.stringify(B) || A.deck.length !== DECK_SIZE || Object.keys(counts).length !== DECK_SIZE + 1) bad++;
        if (A.anchor.id === N.anchor.id && A.deck[0].id === N.deck[0].id) same++;
        const r = solve(A);
        if (!passed(A, r) || !sorted(r)) bad++;
      }
      return { ok: bad === 0 && same === 0, detail: bad + " bad days, " + same + " repeated starts" };
    },
  },
]);
process.exitCode = fails ? 1 : 0;
