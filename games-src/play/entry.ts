// dailyaitoll.com/play: mount Tally. Built on xps with esbuild into web/play/tally.js.
import { mountGame } from "./tally/game";
import { BRAND } from "./brand";

const host = document.getElementById("app");
if (host) {
  host.removeAttribute("aria-busy");
  mountGame(host, BRAND, host.getAttribute("data-cards") || "/play/cards.json");
}
