// Tally: player-facing words. Plain full sentences; the background lives in ABOUT (opened by "Read more").
import type { HowTo, AboutSection } from "../../PlayKit/shell";

export const NAME = "Tally";
export const TAGLINE = "File real reports of AI-linked job cuts by the number of roles each one cut.";

export const HOW_TO: HowTo = {
  goal: [
    "Build the ledger in order. Each card is a real report from the Daily AI Toll ledger, and your job is to file it where its count of lost roles belongs, with the most roles at the top.",
  ],
  control: [
    "Read the report at the top of the board. Its numbers are hidden until you file it.",
    "Pick the File here gap where you think it belongs, between a bigger count above and a smaller count below.",
    "The card then shows its real count and a link to its source, and the next report comes up.",
    "On a keyboard, the arrow keys move between the gaps, Enter files the card, and C runs a scale check.",
  ],
  cost: [
    "A wrong gap costs one miss, and the card is filed where it really belongs so the ledger stays in order. Three misses end the run.",
    "A scale check costs 50 points. It tells you whether the hidden count is under 100, in the hundreds, in the thousands, or 10,000 or more. You get three checks per level.",
  ],
  earn: [
    "Each card filed in the right gap earns 100 points.",
    "Cards filed right in a row add 20 more points for each card after the first.",
    "When you finish, every miss you did not use adds 50 points.",
  ],
  hard: [
    "The ledger fills up as you go, so the gaps get narrower and the later cards sit between counts that are close together.",
    "Headlines say less than you would think. A big company can make a small cut, and a short report can hide thousands of roles.",
  ],
  tip: "Look for clues the masking leaves in place, such as a percentage of the workforce, the size of the company, or words like hundreds and thousands, and save your scale checks for the last few cards.",
};

export const ABOUT: AboutSection[] = [
  {
    h: "Where the cards come from",
    body: [
      "Every card is an entry in the Daily AI Toll ledger, the same records behind the counts on the home page and the Data page. The game takes only entries whose count of roles appears as written in the report's own headline or source excerpt, with a confidence score of 0.8 or more. Reports that call the count an estimate or say it is unconfirmed are left out, and repeat reports of the same cut appear once.",
      "The count on each card is the figure the cited source reported. The game adds no numbers of its own: the score is points for play, and the total at the end is the plain sum of the reported counts on your ledger.",
    ],
  },
  {
    h: "What the labels mean",
    body: [
      "Each report carries the ledger's causality label. Direct means the company named AI or automation as the main reason for the cuts. Contributing means AI was one of several factors, or the cuts came alongside a major AI investment. Inferred means cuts in roles AI tends to affect, with no explicit statement from the company.",
      "These labels come from the ledger's automated review. The methodology page explains how they and the confidence scores are assigned.",
    ],
  },
  {
    h: "What the game leaves out",
    body: [
      "Ordering reports by size is a way to get a feel for scale. It does not weigh one cut against another: a cut of 60 roles at a small company can be a larger share of its people than a cut of 4,000 at a large one.",
      "The ledger is a lower bound. Many AI-linked job losses are never reported, or are reported without a number, and those cannot become cards. Today's level draws from the entries in the ledger when the page loads, so new reports join the deck as they are logged.",
    ],
  },
];
