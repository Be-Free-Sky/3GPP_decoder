// End-to-end check of the published page: open ./index.html straight from disk (file://)
// in a local Chrome or Edge, decode the samples and verify the results.
//
//   npm test            (needs a built index.html: npm run build)
//
// Fails on: any network request, any console error or CSP violation, a wrong verdict.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(ROOT, "index.html");
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const SESSIONS = [
  ["LTE attach, healthy", "No problems found"],
  ["LTE handover failure and call drop", "failures found"],
  ["5G SA registration rejected (no slices)", "1 failure found"],
  ["5G SA PDU session rejected (unknown DNN)", "1 failure found"],
  ["EN-DC: NR leg added, then SCG failure", "1 failure found"],
];
const S1AP_HEX =
  "000c403e000005000800020001001a00161507417208091010103254769802e0e000040201d031004300060000f1100001006440080000f110123450100086400130";

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};

if (!existsSync(PAGE)) {
  console.error("index.html not found. Run: npm run build");
  process.exit(1);
}
const exe = process.env.CHROME_PATH || BROWSERS.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chrome or Edge found (set CHROME_PATH).");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const network = [];
const errors = [];
page.on("request", (r) => {
  if (!/^(file|blob|data):/.test(r.url())) network.push(r.url());
});
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(e.message));

try {
  const t0 = Date.now();
  await page.goto(pathToFileURL(PAGE).href);
  await page.getByText("Decoder ready").first().waitFor({ timeout: 120000 });
  check(true, `engine ready from file:// in ${Date.now() - t0} ms`);

  for (const [title, verdict] of SESSIONS) {
    await page.getByRole("button", { name: "Samples" }).click();
    await page.locator("[data-slot=popover-content]").getByRole("button", { name: title }).click();
    // the previous report stays on screen until the new one arrives: wait for this session's verdict
    const ok = await page
      .waitForFunction(
        ([t, v]) => {
          const ta = document.querySelector("#hex-input");
          const h = [...document.querySelectorAll("h2")].find((x) => /found/.test(x.textContent || ""));
          return Boolean(ta && t && h && h.textContent.includes(v) && !document.querySelector("button[disabled] .animate-spin"));
        },
        [title, verdict],
        { timeout: 60000 },
      )
      .then(() => true)
      .catch(() => false);
    const heading = await page.locator("h2", { hasText: /found/ }).first().innerText();
    check(ok, `${title}: "${heading}"`);
  }

  // an interface message: the S1AP / NGAP block is unpacked on first use
  await page.locator("#hex-input").fill(S1AP_HEX);
  await page.getByRole("button", { name: /^Decode/ }).click();
  const title = await page.locator("main h2").first().innerText({ timeout: 60000 });
  await page.getByText("Initial UE Message").first().waitFor({ timeout: 60000 });
  check(true, `S1AP decoded on demand ("${title}")`);

  check(network.length === 0, `no network requests (${network.length})${network.length ? ": " + network.slice(0, 3).join(", ") : ""}`);
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  check(false, `unexpected error: ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
