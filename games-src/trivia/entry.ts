// dailyaitoll.com/trivia: mount the daily trivia. Built on xps with esbuild into web/trivia/trivia.js.
// Colours follow the site's own tokens, so the page tracks its light/dark toggle.
import { mountTrivia } from "./trivia";
import type { TriviaBank } from "./daily";
import bank from "./questions.json";

const host = document.getElementById("trivia");
if (host) {
  host.removeAttribute("aria-busy");
  mountTrivia(host, bank as unknown as TriviaBank, {
    bg: "var(--surface)",
    line: "var(--border)",
    ink: "var(--text)",
    muted: "var(--muted)",
    good: "#4F9FCF",
    bad: "#D9822B",
    accent: "var(--toll-red-dark)",
    button: "var(--toll-red-dark)",
    buttonInk: "var(--bg)",
    font: "'IBM Plex Mono', monospace",
    heading: "'Inter', sans-serif",
  });
}
