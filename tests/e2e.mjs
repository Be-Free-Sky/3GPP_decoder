// End-to-end check of the published page: open ./index.html straight from disk (file://)
// in a local Chrome or Edge, decode the samples and verify the results.
//
//   npm test            (needs a built index.html: npm run build)
//
// Fails on: any network request, any console error or CSP violation, a wrong verdict.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

// session title -> verdict of the summary card (bad = "The main problem", ok = "All good")
const SESSIONS = [
  ["LTE attach, healthy", "ok"],
  ["LTE handover failure and call drop", "bad"],
  ["5G SA registration rejected (no slices)", "bad"],
  ["5G SA PDU session rejected (unknown DNN)", "bad"],
  ["EN-DC: NR leg added, then SCG failure", "bad"],
];
const S1AP_HEX =
  "000c403e000005000800020001001a00161507417208091010103254769802e0e000040201d031004300060000f1100001006440080000f110123450100086400130";
const SAMPLES = JSON.parse(readFileSync(join(ROOT, "src/data/samples.json"), "utf8"));
const FIXTURE = join(ROOT, "build", "fixtures", "armlog_fixture.zip");

// a synthetic Logel armlog zip in the real binary layout (decoder/tools/build_logel_fixture.py)
const PY = [join(ROOT, ".venv", "Scripts", "python.exe"), join(ROOT, ".venv", "bin", "python")].find((p) => existsSync(p)) ?? "python";
const built = spawnSync(PY, [join(ROOT, "decoder", "tools", "build_logel_fixture.py"), FIXTURE], { cwd: ROOT, encoding: "utf8" });
if (built.status !== 0) {
  console.error("Could not build the armlog fixture:", built.stderr || built.stdout);
  process.exit(1);
}

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

/** Wait until the results header names `title` and the summary shows `verdict`. */
const waitForResult = (title, verdict) =>
  page
    .waitForFunction(
      ([t, v]) => {
        const h1 = document.querySelector("header h1");
        const card = document.querySelector("[data-verdict]");
        return Boolean(h1 && h1.textContent === t && (!v || (card && card.getAttribute("data-verdict") === v)));
      },
      [title, verdict],
      { timeout: 60000 },
    )
    .then(() => true)
    .catch(() => false);

const onHome = async () => (await page.locator("main h1", { hasText: "3GPP Decoder" }).count()) === 1;

try {
  const t0 = Date.now();
  await page.goto(pathToFileURL(PAGE).href);
  await page.getByText("Decoder ready").first().waitFor({ timeout: 120000 });
  check(true, `engine ready from file:// in ${Date.now() - t0} ms`);
  check((await page.locator("#hex-input").inputValue()) === "", "the home page hex box starts empty");

  for (const [title, verdict] of SESSIONS) {
    if (!(await onHome())) await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("tab", { name: /Examples/ }).click();
    await page.getByRole("tabpanel").getByRole("button", { name: new RegExp(`^${title.replace(/[()]/g, "\\$&")}`) }).click();
    const ok = await waitForResult(title, verdict);
    const head = ok ? await page.locator("[data-verdict] h2").first().innerText() : "(no summary)";
    check(ok, `${title}: ${verdict === "ok" ? "All good" : "The main problem"}, "${head}"`);
  }

  // navigation: Home, back to the results, and the browser Back button
  await page.getByRole("button", { name: "Home", exact: true }).click();
  check(await onHome(), "Home button returns to the home page");
  check((await page.locator("#hex-input").inputValue()) === "", "examples never fill the hex box");
  await page.getByRole("button", { name: /Back to the results/ }).click();
  check((await page.getByRole("tab", { name: /Summary/ }).count()) === 1, "Back to the results reopens the last decode");
  await page.goBack();
  await page.locator("#hex-input").waitFor({ timeout: 10000 }).catch(() => {});
  check(await onHome(), "browser Back returns to the home page");

  // a Logel text export opened as a file
  await page.getByRole("tab", { name: /Upload log/ }).click();
  const drop = SAMPLES.sessions.find((s) => s.id === "lte-ho-drop");
  await page.locator("#file-input").setInputFiles({ name: "logel-export.txt", mimeType: "text/plain", buffer: Buffer.from(drop.text) });
  await page.getByRole("button", { name: /^Decode$/ }).click();
  check(await waitForResult("logel-export.txt", "bad"), "a dropped or browsed text file is decoded");

  // a whole Logel armlog as a zip: unzipped in the page, the useful files picked and decoded
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("tab", { name: /Upload log/ }).click();
  await page.locator("#file-input").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: /Analyse log/ }).click();
  const zipName = "armlog_fixture";
  check(await waitForResult(zipName, "bad"), "an armlog zip is unzipped and analysed");
  const head = await page.locator("[data-verdict] h2").first().innerText().catch(() => "");
  check(/#62/.test(head), `the zip's root cause is the NAS cause ("${head}")`);
  check((await page.getByRole("heading", { name: "Files in this log" }).count()) === 1, "the summary lists the files of the log");
  await page.getByRole("tab", { name: /^Files/ }).click();
  const used = await page.locator("li", { hasText: ".logel" }).first().innerText();
  const skipped = await page.locator("li", { hasText: "msgview.dat" }).first().innerText();
  check(/Analysed|Modem log/.test(used) && /RRC and NAS/.test(used), "the .logel is listed as analysed");
  check(/display cache/.test(skipped), "Logel's view cache is listed as not needed, with the reason");
  check((await page.getByText("nosuch.example.net").count()) > 0, "DNS lookups from the IP capture are listed");
  await page.getByRole("tab", { name: /^Radio/ }).click();
  check((await page.getByRole("heading", { name: /Serving cell, from the modem/ }).count()) === 1, "the modem's own radio samples are charted");
  await page.getByRole("tab", { name: /^Messages/ }).click();
  check((await page.getByText("Channel logged by the modem").count()) > 0, "messages use the channel the modem logged");

  // an interface message: the S1AP / NGAP block is unpacked on first use
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator("#hex-input").fill(S1AP_HEX);
  await page.getByRole("button", { name: /^Decode/ }).click();
  await page.getByText("Initial UE Message").first().waitFor({ timeout: 60000 });
  const title = await page.locator("main h2").first().innerText();
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
