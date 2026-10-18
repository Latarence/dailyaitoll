# Trivia (daily, per product landing)

Canonical source. Copy-not-import: each landing carries its own copy.

Copy into a landing (`frontend/landing_app`):

- `TriviaGame.tsx`, `daily.ts`, `share.ts`, `ShareButton.tsx` to `src/components/Trivia/`
- `banks/<slug>.json` to `src/components/Trivia/questions.json`
- `page.example.tsx` to `src/app/trivia/page.tsx` (change the product name and topics in the metadata)
- Add a footer link `{ href: "/trivia", label: "Trivia" }` and a sitemap entry `trivia`

How it works: 5 questions a day, chosen by UTC day number. The bank is shuffled once per cycle
(`floor(N/5)` days) and dealt 5 at a time, so nothing repeats inside a cycle. Options are shuffled per
day. Progress, streak and best streak are kept in `localStorage` (`trivia:<slug>`) only. There are no
accounts and no backend. Brand colors come from `bank.brand`, and layout uses the landing's own
Tailwind tokens (`bg-BG-2`, `border-stroct-1`, `my-text-16`).

Bank rules: well-established facts only. Each entry has a `source`. Nothing time-sensitive or
contested, and no priority disputes. `answer` is an index into `options`. Every bank is fact-checked
in a separate pass before shipping, and doubtful items are dropped.

`~/latarence/scripts/trivia_of_the_day.py` mirrors `daily.ts` exactly (parity checked over 400 days)
and writes the social "trivia of the day" drafts. If you change the selection in one, change the other
too.

Landings that keep the bank in a different place: `huntington` (huntingtonapplied.com) has no
`landing_app`; its landing is `frontend/src`, so the files go to `frontend/src/components/Trivia/` and
`frontend/src/app/trivia/page.tsx`. Repo `SLAI` uses bank slug `slai`.

Share (2026-10-17): the result card has a Share button (`ShareButton.tsx` over `share.ts`, plain DOM). On
touch devices it opens the system share sheet; elsewhere a small menu: Copy link, X, Facebook, LinkedIn,
Threads, Reddit, all plain intent URLs (no SDKs, no pixels). The text is the score, the UTC day and a
right/missed grid, never a question or an answer. Links carry `utm_source=share&utm_medium=<network>&utm_campaign=trivia`,
and a gtag `share` event fires when gtag is on the page. `share.ts` is identical to `PlayKit/share.ts`.
The /trivia page sets its own `openGraph` + `twitter` card (`/og/trivia.png`, 1200x630, code-generated).
