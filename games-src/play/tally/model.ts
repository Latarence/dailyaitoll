// Tally: the rules, DOM-free so check.ts can run them under Node.
// Every card is a real Daily AI Toll ledger entry (web/play/cards.json, written by scripts/build_play_cards.py
// from data/events.jsonl). The game never makes up a count: it only orders the counts the sources reported.
import { dailyRng, utcDayNumber } from "../../PlayKit/rng";

export interface Card {
  id: string;
  date: string;
  roles: number; // tolls.jobs, as reported by the cited source
  headline: string;
  masked: string; // headline with its numbers hidden
  excerpt: string; // source excerpt with its numbers hidden ("" when too short to help)
  source: string;
  url: string;
  causality: string; // direct | contributing | inferred (the ledger's own label)
  confidence: number;
}

export interface Pool {
  count: number;
  cards: Card[];
}

export interface LevelDef {
  id: string; // "main" | "today"
  label: string;
  anchor: Card; // placed for you at the start
  deck: Card[]; // dealt in this order
}

export const DECK_SIZE = 10;
export const MAX_MISSES = 3;
export const MAX_CHECKS = 3;
export const PTS_RIGHT = 100;
export const PTS_STREAK = 20; // per card in a row after the first
export const PTS_CHECK = 50; // a scale check costs this much
export const PTS_SPARE = 50; // each unused miss at the end

/** The main level: chosen by hand from the ledger so early cards sit far apart and later ones close together. */
export const MAIN_IDS = [
  "evt_20260507_003", // anchor: Cloudflare
  "evt_20260622_001", // Oracle
  "evt_20260820_001", // Expedia
  "evt_20260528_001", // Standard Chartered
  "evt_20260708_002", // Starling Bank
  "evt_20261006_001", // HubSpot
  "evt_20261012_001", // Kroger
  "evt_20260817_001", // Pentera
  "evt_20260715_001", // Sprout Social
  "evt_20260706_001", // Microsoft
  "evt_20260602_001", // GitLab
];

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** Up to n cards whose role counts all differ (so every card has exactly one right place). */
function distinct(cards: Card[], n: number, avoid: { [roles: number]: boolean }): Card[] {
  const out: Card[] = [];
  const used: { [roles: number]: boolean } = {};
  for (const k in avoid) used[+k] = true;
  for (let i = 0; i < cards.length && out.length < n; i++) {
    if (used[cards[i].roles]) continue;
    used[cards[i].roles] = true;
    out.push(cards[i]);
  }
  return out;
}

export function mainLevel(pool: Pool): LevelDef {
  const byId: { [id: string]: Card } = {};
  for (let i = 0; i < pool.cards.length; i++) byId[pool.cards[i].id] = pool.cards[i];
  const picked: Card[] = [];
  for (let i = 0; i < MAIN_IDS.length; i++) if (byId[MAIN_IDS[i]]) picked.push(byId[MAIN_IDS[i]]);
  // if the ledger ever drops one of the chosen entries, top up deterministically from the rest
  if (picked.length < DECK_SIZE + 1) {
    const avoid: { [roles: number]: boolean } = {};
    for (let i = 0; i < picked.length; i++) avoid[picked[i].roles] = true;
    const rest = shuffle(pool.cards.filter((c) => MAIN_IDS.indexOf(c.id) < 0), dailyRng("tally-main", 0));
    const extra = distinct(rest, DECK_SIZE + 1 - picked.length, avoid);
    for (let i = 0; i < extra.length; i++) picked.push(extra[i]);
  }
  return { id: "main", label: "1 · The ledger", anchor: picked[0], deck: picked.slice(1, DECK_SIZE + 1) };
}

/** Today's level: the same eleven cards for everyone on a UTC day. */
export function dailyLevel(pool: Pool, day: number = utcDayNumber()): LevelDef {
  const deal = (d: number) => distinct(shuffle(pool.cards, dailyRng("tally", d)), DECK_SIZE + 1, {});
  const cards = deal(day);
  // consecutive days never open on the same filed card
  if (cards.length > 1 && cards[0].id === deal(day - 1)[0].id) {
    const t = cards[0];
    cards[0] = cards[1];
    cards[1] = t;
  }
  return { id: "today", label: "Today", anchor: cards[0], deck: cards.slice(1) };
}

/** The ledger as placed, largest count first. Slot i sits above ledger[i]; slot ledger.length is the bottom. */
export function rightSlot(ledger: Card[], card: Card): number {
  let i = 0;
  while (i < ledger.length && ledger[i].roles > card.roles) i++;
  return i;
}

/** A slot is right when the card's count fits between its neighbours (equal counts fit either side). */
export function fits(ledger: Card[], slot: number, card: Card): boolean {
  const above = slot > 0 ? ledger[slot - 1].roles : Infinity;
  const below = slot < ledger.length ? ledger[slot].roles : -Infinity;
  return card.roles <= above && card.roles >= below;
}

export function insertAt(ledger: Card[], slot: number, card: Card): Card[] {
  return ledger.slice(0, slot).concat([card], ledger.slice(slot));
}

/** What a scale check tells you: the band the count falls in. */
export function scaleBand(roles: number): string {
  if (roles < 100) return "fewer than 100 roles";
  if (roles < 1000) return "100 to 999 roles";
  if (roles < 10000) return "1,000 to 9,999 roles";
  return "10,000 roles or more";
}

export interface Run {
  ledger: Card[];
  next: number; // index into deck
  right: number;
  misses: number;
  streak: number;
  bestStreak: number;
  checks: number;
  checkedThis: boolean;
  score: number;
  log: { id: string; ok: boolean }[];
}

export function newRun(level: LevelDef): Run {
  return { ledger: [level.anchor], next: 0, right: 0, misses: 0, streak: 0, bestStreak: 0, checks: 0, checkedThis: false, score: 0, log: [] };
}

export function useCheck(run: Run): boolean {
  if (run.checkedThis || run.checks >= MAX_CHECKS) return false;
  run.checks++;
  run.checkedThis = true;
  run.score -= PTS_CHECK;
  return true;
}

/** Place the current card. A wrong slot still files the card where it belongs, and costs a miss. */
export function place(level: LevelDef, run: Run, slot: number): { ok: boolean; at: number; gained: number } {
  const card = level.deck[run.next];
  const ok = fits(run.ledger, slot, card);
  const at = ok ? slot : rightSlot(run.ledger, card);
  run.ledger = insertAt(run.ledger, at, card);
  run.next++;
  run.checkedThis = false;
  let gained = 0;
  if (ok) {
    run.right++;
    run.streak++;
    if (run.streak > run.bestStreak) run.bestStreak = run.streak;
    gained = PTS_RIGHT + PTS_STREAK * (run.streak - 1);
  } else {
    run.misses++;
    run.streak = 0;
  }
  run.score += gained;
  run.log.push({ id: card.id, ok });
  return { ok, at, gained };
}

export function isOver(level: LevelDef, run: Run): boolean {
  return run.misses >= MAX_MISSES || run.next >= level.deck.length;
}

export function passed(level: LevelDef, run: Run): boolean {
  return run.misses < MAX_MISSES && run.next >= level.deck.length;
}

export function finalScore(level: LevelDef, run: Run): number {
  return run.score + (passed(level, run) ? PTS_SPARE * (MAX_MISSES - 1 - run.misses) : 0);
}

export function marks(level: LevelDef, run: Run): { label: string; got: boolean }[] {
  return [
    { label: "Ledger filed", got: passed(level, run) },
    { label: "One miss or fewer", got: passed(level, run) && run.misses <= 1 },
    { label: "No scale checks", got: passed(level, run) && run.checks === 0 },
  ];
}

/** The real total of the roles on a finished ledger (a sum of reported counts). */
export function ledgerRoles(run: Run): number {
  let s = 0;
  for (let i = 0; i < run.ledger.length; i++) s += run.ledger[i].roles;
  return s;
}

export function fmt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
