// Tally at dailyaitoll.com/play: file real ledger reports by the number of roles each one cut.
// DOM board inside the PlayKit shell, plus a code-drawn log scale of the counts filed so far.
import { createShell, type Shell } from "../../PlayKit/shell";
import type { PlayBrand } from "../../PlayKit/brand";
import { MONO, withAlpha } from "../../PlayKit/brand";
import { createSurface, type Surface } from "../../PlayKit/canvas";
import { createStore } from "../../PlayKit/save";
import { utcDayNumber, dayLabel } from "../../PlayKit/rng";
import {
  type Card, type Pool, type LevelDef, type Run,
  mainLevel, dailyLevel, newRun, place, rightSlot, useCheck, isOver, passed, finalScore, marks, ledgerRoles, scaleBand, fmt,
  DECK_SIZE, MAX_MISSES, MAX_CHECKS, PTS_CHECK,
} from "./model";
import { HOW_TO, ABOUT, NAME, TAGLINE } from "./copy";

type Saved = { best: { [k: string]: number }; done: { [k: string]: boolean } };

const CAUSE: { [k: string]: string } = {
  direct: "Direct: the company named AI or automation as the main reason",
  contributing: "Contributing: AI was one of several stated factors",
  inferred: "Inferred: cuts in AI-exposed roles, with no explicit statement",
};

const CSS = (b: PlayBrand) => `
.tl{padding:12px 14px 16px;display:flex;flex-direction:column;gap:12px}
.tl-scale{border:1px solid var(--ln);border-radius:3px;background:var(--p)}
.tl-now{border:1px solid var(--a);border-radius:4px;background:${withAlpha(b.accent, 0.07)};padding:12px 14px}
.tl-kick{font-family:${MONO};font-size:11px;color:var(--mu);letter-spacing:.02em;margin:0 0 6px;overflow-wrap:anywhere}
.tl-head{font-size:16px;font-weight:600;margin:0 0 8px;overflow-wrap:anywhere}
.tl-ex{font-size:13px;color:var(--mu);margin:0 0 8px;overflow-wrap:anywhere}
.tl-row2{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tl-band{font-family:${MONO};font-size:12px;color:var(--warn)}
.tl-ledger{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.tl-slot{width:100%;min-height:34px;border:1px dashed ${withAlpha(b.accent, 0.55)};background:transparent;border-radius:3px;color:var(--a);font-size:12px;font-family:${MONO};padding:4px 8px}
.tl-slot:hover,.tl-slot:focus-visible{background:${withAlpha(b.accent, 0.12)};outline:2px solid var(--a);outline-offset:1px}
.tl-card{display:grid;grid-template-columns:minmax(64px,auto) 1fr;gap:4px 12px;align-items:baseline;border:1px solid var(--ln);border-radius:3px;background:var(--p2);padding:8px 10px}
.tl-card.ok{border-color:var(--good)}
.tl-card.miss{border-color:var(--bad)}
.tl-n{font-family:${MONO};font-size:15px;font-weight:600;text-align:right;white-space:nowrap}
.tl-t{min-width:0;overflow-wrap:anywhere}
.tl-t b{font-weight:500;font-size:14px}
.tl-m{display:block;font-family:${MONO};font-size:11px;color:var(--mu);margin-top:2px}
.tl-m a{color:var(--mu)}
.tl-flag{font-family:${MONO};font-size:11px;margin-left:6px}
.tl-card.ok .tl-flag{color:var(--good)}
.tl-card.miss .tl-flag{color:var(--bad)}
.tl-stat{display:flex;flex-wrap:wrap;gap:6px 16px;font-family:${MONO};font-size:12px;color:var(--mu)}
.tl-stat b{color:var(--ink);font-weight:600}
.tl-note{font-size:12px;color:var(--mu);margin:0}
@media (max-width:640px){.tl{padding:10px}.tl-card{grid-template-columns:1fr}.tl-n{text-align:left}}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountGame(host: HTMLElement, brand: PlayBrand, cardsUrl = "/play/cards.json"): () => void {
  const store = createStore<Saved>("dailyaitoll.tally", 1, () => ({ best: {}, done: {} }));
  const saved = store.load();
  const day = utcDayNumber();
  const todayKey = "today:" + day;

  let pool: Pool | null = null;
  let level: LevelDef | null = null;
  let run: Run | null = null;
  let levelId = "main";
  let lastAt = -1;
  let lastOk = true;
  let band = "";

  const shell: Shell = createShell(host, {
    brand,
    slug: "tally",
    name: NAME,
    tagline: TAGLINE,
    about: ABOUT,
    howTo: HOW_TO,
    onLevel: (id) => start(id),
    productLine: "See today's toll on " + brand.product,
  });
  const st = el("style");
  st.textContent = CSS(brand);
  shell.root.appendChild(st);

  const board = el("div", "tl");
  shell.stage.insertBefore(board, shell.stage.firstChild);
  const scaleHost = el("div", "tl-scale");
  board.appendChild(scaleHost);
  const now = el("div", "tl-now");
  now.setAttribute("aria-live", "polite");
  board.appendChild(now);
  const stat = el("div", "tl-stat");
  board.appendChild(stat);
  const list = el("ol", "tl-ledger");
  list.setAttribute("aria-label", "The ledger, most roles at the top");
  board.appendChild(list);
  const note = el("p", "tl-note", "Every count is the figure the cited source reported, as logged in the Daily AI Toll ledger.");
  board.appendChild(note);

  // createSurface sizes the canvas (and fires onResize) before it returns, so drawScale waits for the handle
  let surf: Surface | null = null;
  surf = createSurface(scaleHost, { aspect: 12, minH: 58, maxH: 66, onResize: () => drawScale() });

  const checkBtn = shell.button("Check the scale (-" + PTS_CHECK + ")", () => doCheck(), { title: "Shows the band this card's count falls in. Costs points." });
  const restartBtn = shell.button("Restart level", () => start(levelId));

  function tabs() {
    shell.setLevels(
      [
        { id: "main", label: "1 · The ledger", done: !!saved.done.main },
        { id: "today", label: "Today · " + dayLabel(day), done: !!saved.done[todayKey] },
      ],
      levelId,
    );
  }

  function start(id: string) {
    if (!pool) return;
    levelId = id === "today" ? "today" : "main";
    level = levelId === "main" ? mainLevel(pool) : dailyLevel(pool, day);
    run = newRun(level);
    lastAt = -1;
    band = "";
    shell.hideCard();
    tabs();
    shell.setBrief(
      levelId === "main" ? "The ledger" : "Today's ledger",
      "File each report where its count belongs, most roles at the top. One report is filed for you.",
      [DECK_SIZE + " reports", MAX_MISSES + " misses end the run"],
    );
    shell.audio.start();
    render();
  }

  function cur(): Card | null {
    return level && run && !isOver(level, run) ? level.deck[run.next] : null;
  }

  function doCheck() {
    const c = cur();
    if (!c || !run) return;
    if (!useCheck(run)) {
      shell.toast(run.checkedThis ? "Already checked this card" : "No scale checks left");
      shell.audio.invalid();
      return;
    }
    band = scaleBand(c.roles);
    shell.audio.ui();
    render();
  }

  function doPlace(slot: number) {
    if (!level || !run || isOver(level, run)) return;
    const r = place(level, run, slot);
    lastAt = r.at;
    lastOk = r.ok;
    band = "";
    if (r.ok) shell.audio.place(560 + Math.min(run.streak, 6) * 60);
    else shell.audio.erase();
    shell.toast(r.ok ? "Filed. +" + r.gained : "Missed. Filed where it belongs.", 1400);
    render();
    if (isOver(level, run)) finish();
    else {
      // keep keyboard play flowing: focus the slot nearest the one just used
      const slots = list.querySelectorAll<HTMLButtonElement>(".tl-slot");
      const t = slots[Math.min(r.at + (r.ok ? 1 : 0), slots.length - 1)];
      if (t && list.contains(document.activeElement))
        try {
          t.focus({ preventScroll: true });
        } catch {
          /* older browsers */
        }
    }
  }

  function finish() {
    if (!level || !run) return;
    const ok = passed(level, run);
    const score = finalScore(level, run);
    const key = levelId === "main" ? "main" : todayKey;
    if (ok) {
      saved.done[key] = true;
      if (!(saved.best[key] >= score)) saved.best[key] = score;
      store.save(saved, true);
      tabs();
      shell.audio.win();
    } else shell.audio.fail();
    const m = marks(level, run);
    let got = 0;
    for (let i = 0; i < m.length; i++) if (m[i].got) got++;
    const grid = run.log.map((x) => (x.ok ? "■" : "□")).join("");
    shell.showCard({
      pass: ok,
      title: ok ? "Ledger filed" : "The run ended at " + MAX_MISSES + " misses",
      cause: ok
        ? "These " + run.ledger.length + " reports account for " + fmt(ledgerRoles(run)) + " roles as their sources reported them."
        : "Each miss was filed where it belongs, so the ledger still reads in order. Try the level again; the cards come in the same order.",
      marks: m,
      stats: [
        ["Score", fmt(score)],
        ["Placed right", run.right + " of " + level.deck.length],
        ["Misses", String(run.misses)],
        ["Best streak", String(run.bestStreak)],
        ["Scale checks", run.checks + " of " + MAX_CHECKS],
        ["Best score", saved.best[key] !== undefined ? fmt(saved.best[key]) : "none yet"],
      ],
      actions: [
        { label: "Play again", primary: !ok, onClick: () => start(levelId) },
        levelId === "main"
          ? { label: "Play today's ledger", primary: ok, onClick: () => start("today") }
          : { label: "Play the main ledger", onClick: () => start("main") },
      ],
      share: ok
        ? {
            text:
              "I filed " + (levelId === "today" ? "today's" : "the") + " Tally ledger on Daily AI Toll: " + run.right + " of " + level.deck.length +
              " placed right, " + got + " of 3 marks.\n" + grid + " " + dayLabel(day) + " UTC",
          }
        : false,
    });
    for (let i = 0; i < m.length; i++) if (m[i].got) shell.audio.mark(i);
    shell.track("play_complete", { level: levelId, pass: ok ? 1 : 0, score });
  }

  function cardRow(c: Card, i: number): HTMLElement {
    const li = el("li", "tl-card" + (i === lastAt ? (lastOk ? " ok" : " miss") : ""));
    li.appendChild(el("span", "tl-n", fmt(c.roles)));
    const t = el("span", "tl-t");
    t.appendChild(el("b", "", c.headline));
    if (i === lastAt) t.appendChild(el("span", "tl-flag", lastOk ? "✓ placed right" : "✗ missed, filed here"));
    const m = el("span", "tl-m");
    const a = el("a", "", c.source || "source") as HTMLAnchorElement;
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    m.appendChild(a);
    m.appendChild(document.createTextNode(" · " + c.date + " · " + c.causality));
    t.appendChild(m);
    li.appendChild(t);
    return li;
  }

  function slotBtn(i: number, n: number, ledger: Card[]): HTMLElement {
    const li = el("li");
    const b = el("button", "tl-slot", i === 0 ? "File here (top)" : i === n ? "File here (bottom)" : "File here") as HTMLButtonElement;
    b.type = "button";
    const above = i > 0 ? fmt(ledger[i - 1].roles) : "";
    const below = i < n ? fmt(ledger[i].roles) : "";
    b.setAttribute(
      "aria-label",
      above && below ? "File between " + above + " and " + below + " roles" : above ? "File below " + above + " roles" : "File above " + below + " roles",
    );
    b.addEventListener("click", () => doPlace(i));
    li.appendChild(b);
    return li;
  }

  function render() {
    if (!level || !run) return;
    const c = cur();
    now.innerHTML = "";
    if (c) {
      now.appendChild(
        el("p", "tl-kick", "Report " + (run.next + 1) + " of " + level.deck.length + " · " + c.date + " · " + (c.source || "source") + " · " + c.causality),
      );
      now.appendChild(el("p", "tl-head", c.masked));
      if (c.excerpt) now.appendChild(el("p", "tl-ex", "“" + c.excerpt + "”"));
      const r2 = el("div", "tl-row2");
      r2.appendChild(el("span", "tl-m", CAUSE[c.causality] || ""));
      if (band) r2.appendChild(el("span", "tl-band", "Scale check: " + band));
      now.appendChild(r2);
    } else {
      now.appendChild(el("p", "tl-kick", passed(level, run) ? "All reports filed" : "Run over"));
      now.appendChild(el("p", "tl-head", "The ledger below is in order, most roles at the top. Each source is linked."));
    }
    stat.innerHTML = "";
    const s = (k: string, v: string) => {
      const x = el("span", "", k + " ");
      x.appendChild(el("b", "", v));
      stat.appendChild(x);
    };
    s("Score", fmt(run.score));
    s("Misses", "■".repeat(run.misses) + "□".repeat(Math.max(0, MAX_MISSES - run.misses)));
    s("Streak", String(run.streak));
    s("Checks left", String(MAX_CHECKS - run.checks));
    list.innerHTML = "";
    const n = run.ledger.length;
    for (let i = 0; i <= n; i++) {
      if (c) list.appendChild(slotBtn(i, n, run.ledger));
      if (i < n) list.appendChild(cardRow(run.ledger[i], i));
    }
    checkBtn.disabled = !c || run.checkedThis || run.checks >= MAX_CHECKS;
    drawScale();
  }

  // log scale from 1 to 100,000 roles; filed counts as ticks, the checked band shaded
  function drawScale() {
    if (!surf) return;
    const g = surf.ctx;
    surf.begin();
    const W = surf.w, H = surf.h;
    g.clearRect(0, 0, W, H);
    const L = 14, R = W - 14, y = Math.round(H * 0.42);
    const X = (v: number) => L + ((Math.log(Math.max(1, v)) / Math.LN10) / 5) * (R - L);
    if (band && run && cur()) {
      const c = cur() as Card;
      const lo = c.roles < 100 ? 1 : c.roles < 1000 ? 100 : c.roles < 10000 ? 1000 : 10000;
      const hi = lo === 1 ? 100 : lo * 10;
      g.fillStyle = withAlpha(brand.warn, 0.18);
      g.fillRect(X(lo), 4, X(hi) - X(lo), H - 8);
    }
    g.strokeStyle = brand.line;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(L, y + 0.5);
    g.lineTo(R, y + 0.5);
    g.stroke();
    g.font = "10px " + MONO;
    g.fillStyle = brand.muted;
    g.textBaseline = "top";
    const labels = ["1", "10", "100", "1k", "10k", "100k"];
    for (let k = 0; k <= 5; k++) {
      const x = X(Math.pow(10, k));
      g.fillRect(Math.round(x), y - 4, 1, 9);
      g.textAlign = k === 0 ? "left" : k === 5 ? "right" : "center";
      g.fillText(labels[k], x, y + 9);
    }
    g.textAlign = "left";
    g.fillText("roles per report (log scale)", L, 3);
    if (!run) return;
    for (let i = 0; i < run.ledger.length; i++) {
      const v = run.ledger[i].roles;
      const x = X(v);
      const latest = i === lastAt;
      g.fillStyle = latest ? (lastOk ? brand.good : brand.bad) : brand.ink;
      g.fillRect(Math.round(x) - (latest ? 2 : 1), y - (latest ? 12 : 8), latest ? 4 : 2, latest ? 16 : 10);
    }
  }

  // keyboard: arrows move between the File here slots, C checks the scale
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const slots = Array.prototype.slice.call(list.querySelectorAll(".tl-slot")) as HTMLButtonElement[];
      if (!slots.length) return;
      let i = slots.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) i = e.key === "ArrowDown" ? -1 : slots.length;
      i = Math.max(0, Math.min(slots.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      e.preventDefault();
      slots[i].focus();
    } else if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey && shell.root.contains(document.activeElement)) {
      doCheck();
    }
  }
  shell.root.addEventListener("keydown", onKey);
  // headless playtest hook: the right gap for the current card (read-only; used by the xps check)
  (window as unknown as { __playTest?: object }).__playTest = {
    rightSlot: () => {
      const c = cur();
      return c && run ? rightSlot(run.ledger, c) : -1;
    },
  };

  now.appendChild(el("p", "tl-kick", "Loading the ledger…"));
  let alive = true;
  fetch(cardsUrl, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((p: Pool) => {
      if (!alive) return;
      pool = p;
      start("main");
    })
    .catch(() => {
      if (!alive) return;
      now.innerHTML = "";
      now.appendChild(el("p", "tl-head", "The ledger could not load. Refresh the page to try again."));
    });

  return () => {
    alive = false;
    shell.root.removeEventListener("keydown", onKey);
    if (surf) surf.destroy();
    shell.destroy();
  };
}
