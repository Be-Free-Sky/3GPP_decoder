// End-to-end check of the published page: open ./index.html straight from disk (file://)
// in a local Chrome or Edge, decode the samples and verify the results.
//
//   npm test            (needs a built index.html: npm run build)
//
// Fails on: any network request, any console error or CSP violation, a wrong verdict.

import { existsSync, readFileSync, rmSync } from "node:fs";
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
const FIXTURE_MULTI = join(ROOT, "build", "fixtures", "armlogs_multi.zip");

// a synthetic Logel armlog zip in the real binary layout (decoder/tools/build_logel_fixture.py)
const PY = [join(ROOT, ".venv", "Scripts", "python.exe"), join(ROOT, ".venv", "bin", "python")].find((p) => existsSync(p)) ?? "python";
const built = spawnSync(PY, [join(ROOT, "decoder", "tools", "build_logel_fixture.py"), FIXTURE], { cwd: ROOT, encoding: "utf8" });
const builtMulti = spawnSync(PY, [join(ROOT, "decoder", "tools", "build_logel_fixture.py"), FIXTURE_MULTI, "--multi"], { cwd: ROOT, encoding: "utf8" });
if (built.status !== 0 || builtMulti.status !== 0) {
  console.error("Could not build the armlog fixtures:", built.stderr || built.stdout, builtMulti.stderr || builtMulti.stdout);
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
// keep what Copy report puts on the clipboard (headless browsers have no clipboard to read back)
await page.addInitScript(() => {
  window.__copied = [];
  const write = async (items) => {
    for (const it of items) window.__copied.push(await (await it.getType("text/html")).text());
  };
  Object.defineProperty(navigator, "clipboard", { value: { write, writeText: async () => {} }, configurable: true });
});
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

/** A row of the Files list, by the file's exact name. */
const fileRow = (name) =>
  page
    .locator("li")
    .filter({ has: page.locator("span.font-mono").getByText(name, { exact: true }) })
    .first();

const onHome = async () => (await page.locator("main h1", { hasText: "3GPP Decoder" }).count()) === 1;

try {
  const t0 = Date.now();
  await page.goto(pathToFileURL(PAGE).href);
  await page.getByText("Decoder ready").first().waitFor({ timeout: 120000 });
  check(true, `engine ready from file:// in ${Date.now() - t0} ms`);
  check((await page.locator("#hex-input").inputValue()) === "", "the home page hex box starts empty");

  // the title and feature cards on the left stay put whichever tab the card on the right shows
  const leftAt = [];
  for (const t of [/Upload log/, /Examples/, /Paste hex/]) {
    await page.getByRole("tab", { name: t }).click();
    await page.waitForTimeout(400);
    leftAt.push(JSON.stringify([(await page.locator("main h1").boundingBox()).y, (await page.locator('section[aria-label="Features"]').boundingBox()).y]));
  }
  check(new Set(leftAt).size === 1, `the left column does not move between tabs (${leftAt.join(" ")})`);

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
  check(
    /Times: the modem's clock as Logel shows it, tick 503,000 = 2026-01-15 09:14:03\.000/.test(used),
    "times use the clock Logel stores with its own views (tick 503,000 = 09:14:03.000)",
  );
  check(/display cache/.test(skipped) && /Searched/.test(skipped), "Logel's view cache is listed with the reason, and searched");
  const tv = await fileRow("traceview.dat").innerText();
  check(/decoded traces/i.test(tv) && /no assert or crash, 1 line mentions one/.test(tv), `Logel's decoded traces are searched line by line ("${tv.split("\n").find((l) => /^Searched/.test(l))}")`);
  check((await page.getByText("nosuch.example.net").count()) > 0, "DNS lookups from the IP capture are listed");
  await page.getByRole("tab", { name: /^Radio/ }).click();
  check((await page.getByRole("heading", { name: /Serving cell, from the modem/ }).count()) === 1, "the modem's own radio samples are charted");
  await page.getByRole("tab", { name: /^Messages/ }).click();
  check((await page.getByText("Channel logged by the modem").count()) > 0, "messages use the channel the modem logged");
  // every file is searched for asserts and crashes; this log has none, and says so
  await page.getByRole("tab", { name: /^Asserts/ }).click();
  const noCrash = await page.locator("[data-crash-verdict]").innerText().catch(() => "");
  check(/No assert or crash/.test(noCrash) && (await page.locator('[data-crash-verdict="ok"]').count()) === 1, "the Asserts page says no assert or crash was found");
  await page.getByText(/line mentions an assert or crash in passing/).click();
  const mention = await page.locator('[data-crash-line="weak"]').first().innerText().catch(() => "");
  check(/assert check passed/.test(mention) && /09:14:00\.300/.test(mention), `a passing mention is listed, timed from Logel's trace index ("${mention.replace(/\s+/g, " ")}")`);

  // Copy report: the page on screen as HTML with its colours and cards, charts as images
  const copied = async (tab, n) => {
    await page.getByRole("tab", { name: tab }).click();
    await page.getByRole("button", { name: /Copy report/ }).click();
    await page.waitForFunction((k) => window.__copied.length >= k, n, { timeout: 30000 });
    return page.evaluate((k) => window.__copied[k - 1], n);
  };
  const sumHtml = await copied(/^Summary/, 1);
  check(/#62/.test(sumHtml) && /border-top:4px solid/.test(sumHtml) && /Files in this log/.test(sumHtml), "Copy report copies the Summary page with its cards");
  check(!/SKYWORTH|Copyright|3GPP Decoder/.test(sumHtml), "Copy report leaves out the header and the footer");
  const radioHtml = await copied(/^Radio/, 2);
  check((radioHtml.match(/data:image\/png/g) || []).length >= 2, "Copy report turns the radio charts into images for Outlook");
  const flowHtml = await copied(/^Signalling flow/, 3);
  check(/RRC Setup Request/.test(flowHtml) && /&#9654;|&#9664;/.test(flowHtml), "Copy report copies the signalling ladder");

  // HTML report: the app itself on this analysis, without the list of files
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /HTML report/ }).first().click()]);
  const reportFile = join(ROOT, "build", "fixtures", "report.html");
  await dl.saveAs(reportFile);
  const reportText = readFileSync(reportFile, "utf8");
  check(!/data-asset=/.test(reportText) && !/msgview\.dat/.test(reportText), `the HTML report carries no decoder engine and no file list (${(reportText.length / 1048576).toFixed(1)} MB)`);
  const viewer = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const viewerNet = [];
  const viewerErr = [];
  viewer.on("request", (r) => !/^(file|blob|data):/.test(r.url()) && viewerNet.push(r.url()));
  viewer.on("pageerror", (e) => viewerErr.push(e.message));
  viewer.on("console", (m) => m.type() === "error" && viewerErr.push(m.text()));
  await viewer.goto(pathToFileURL(reportFile).href);
  const opened = await viewer.locator("[data-verdict] h2").first().innerText({ timeout: 20000 }).catch(() => "");
  check(/#62/.test(opened), `the HTML report opens on the same summary ("${opened}")`);
  const viewerTabs = (await viewer.getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim());
  check(
    ["Summary", "Signalling flow", "Messages", "Radio", "Context"].every((t) => viewerTabs.includes(t)) && !viewerTabs.includes("Files"),
    `the HTML report has the app's pages without Files (${viewerTabs.join(", ")})`,
  );
  check((await viewer.getByRole("button", { name: "Home", exact: true }).count()) === 0, "the HTML report has no Home button");
  const exports = await viewer.getByRole("button", { name: /Copy report|HTML report|Copy the summary|Print or save as PDF|JSON/ }).count();
  check(exports === 0, `the HTML report is a viewer only, with no copy or export buttons (${exports})`);
  await viewer.getByRole("tab", { name: /^Messages/ }).click();
  await viewer.locator('[role="option"]').nth(2).click();
  check((await viewer.getByText("Message 3 of").count()) === 1, "messages open in the HTML report as in the app");
  check(viewerNet.length === 0 && viewerErr.length === 0, `the HTML report runs offline without errors${viewerErr.length ? ": " + viewerErr[0] : ""}`);
  await viewer.close();

  // folders picked one at a time with the folder button, then Add another folder
  const FOLDERS = join(ROOT, "build", "fixtures", "folders");
  rmSync(FOLDERS, { recursive: true, force: true });
  const unzip = spawnSync(PY, ["-c", `import zipfile; zipfile.ZipFile(r"${FIXTURE_MULTI}").extractall(r"${FOLDERS}")`], { encoding: "utf8" });
  check(unzip.status === 0, "the fixture folders are unpacked for the folder picker");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("tab", { name: /Upload log/ }).click();
  let [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose a folder" }).click()]);
  await chooser.setFiles(join(FOLDERS, "2026_01_15_09_14_00_000_armlog"));
  const oneLog = await page.getByRole("button", { name: /Analyse log/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  check(oneLog, "a folder chosen with Choose a folder is ready to analyse");
  [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Add another folder" }).click()]);
  await chooser.setFiles(join(FOLDERS, "2026_01_15_12_14_00_000_armlog"));
  const twoLogs = await page.getByRole("button", { name: /Analyse 2 logs/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const picked = await page.getByRole("list", { name: "Logs found" }).innerText().catch(() => "");
  check(twoLogs && /09_14/.test(picked) && /12_14/.test(picked), `Add another folder adds the second folder to the selection (${picked.split("\n").length} lines)`);
  await page.getByRole("button", { name: "Start again" }).click();

  // several _armlog folders: each read on its own, with a message per folder and the ones with issues named
  await page.locator("#file-input").setInputFiles(FIXTURE_MULTI);
  await page.getByRole("button", { name: /Analyse 4 logs/ }).waitFor({ timeout: 20000 });
  const listed = await page.getByRole("list", { name: "Logs found" }).getByRole("listitem").count();
  check(listed === 4, `the four _armlog folders are found before analysing (${listed})`);
  await page.getByRole("button", { name: /Analyse 4 logs/ }).click();
  const fleetDone = await page
    .waitForFunction(() => document.querySelectorAll("[data-log]").length === 4 && !document.querySelector('[data-log][data-tone="busy"]'), null, { timeout: 120000 })
    .then(() => true)
    .catch(() => false);
  const tones = await page.locator("[data-log]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-log")}=${e.getAttribute("data-tone")}`));
  check(
    fleetDone &&
      tones.join(" ") ===
        "2026_01_15_09_14_00_000_armlog=bad 2026_01_15_10_14_00_000_armlog=bad 2026_01_15_11_14_00_000_armlog=none 2026_01_15_12_14_00_000_armlog=bad",
    `each folder gets its own result (${tones.join(", ")})`,
  );
  const fleetHead = await page.locator("[data-fleet-tone] h2").innerText();
  check(
    /2026_01_15_09_14_00_000_armlog/.test(fleetHead) && /2026_01_15_10_14_00_000_armlog/.test(fleetHead) && !/11_14/.test(fleetHead),
    `the overview names the folders with issues ("${fleetHead}")`,
  );
  const noLogel = await page.locator('[data-log="2026_01_15_11_14_00_000_armlog"]').innerText();
  check(/No modem log in this folder/.test(noLogel), "a folder without a .logel says why it was not analysed");
  const pduCard = await page.locator('[data-log="2026_01_15_10_14_00_000_armlog"]').innerText();
  check(/#27/.test(pduCard), "each folder shows its own problem (PDU session reject #27)");
  check(/assert on request \(AT\+SPATASSERT\)/.test(pduCard), "an assert asked for by AT command is noted, not taken for the problem");
  await page.locator('[data-log="2026_01_15_10_14_00_000_armlog"]').getByRole("button", { name: /Open this log/ }).click();
  check(await waitForResult("2026_01_15_10_14_00_000_armlog", "bad"), "a folder opens on its own summary");
  check((await page.locator('[data-crash-summary="warn"]').count()) === 1, "the summary says the modem was stopped on request");
  await page.getByRole("tab", { name: /^Asserts/ }).click();
  const forced = await page.locator('[data-crash-event="forced"]').first().innerText().catch(() => "");
  check(
    (await page.locator('[data-crash-verdict="warn"]').count()) === 1 && /Asked for, not a fault/.test(forced) && /AT channel 2/.test(forced) && /atc_basic_cmd\.c/.test(forced) && /T_P_ATC/.test(forced),
    "the assert console inside the .logel is read: an assert asked for with AT+SPATASSERT, and on which AT channel",
  );
  await page.getByRole("tab", { name: /^All logs/ }).click();
  check((await page.locator("[data-log]").count()) === 4, "All logs goes back to the overview");

  // a modem assert: the .ass record read field by field, found in every file, and made the root cause
  const crashCard = await page.locator('[data-log="2026_01_15_12_14_00_000_armlog"]').innerText();
  check(/Modem assert in NR RRC \(nrrc_cell_select\.c line 1187\)/.test(crashCard), `the folder with an assert says so first ("${crashCard.split("\n").find((l) => /Modem assert/.test(l))}")`);
  await page.locator('[data-log="2026_01_15_12_14_00_000_armlog"]').getByRole("button", { name: /Open this log/ }).click();
  check(await waitForResult("2026_01_15_12_14_00_000_armlog", "bad"), "the log with an assert opens on its summary");
  const crashHead = await page.locator("[data-verdict] h2").first().innerText().catch(() => "");
  check(/Modem assert/.test(crashHead), `the assert is the root cause, ahead of the reject ("${crashHead}")`);
  check((await page.locator("[data-crash-summary]").count()) === 1, "the summary shows the crash card under the headline");
  await page.getByRole("tab", { name: /^Asserts/ }).click();
  const ev = page.locator('[data-crash-event="assert"]');
  const evText = await ev.first().innerText().catch(() => "");
  check((await ev.count()) === 1, `the .ass record and the same record in the .logel's assert console are one event (${await ev.count()})`);
  check(
    /nrrc_cell_select\.c/.test(evText) && /line 1187/.test(evText) && /SCI_ASSERT\(cell_idx < NRRC_MAX_CELL_NUM\)/.test(evText) && /T_NRRC/.test(evText) && /invalid cell index 17/.test(evText) && /also in .*assert console/.test(evText),
    "the UNISOC assert record gives where, the check, the task and the assert info",
  );
  for (const d of await ev.first().locator("details").all()) await d.evaluate((el) => (el.open = true));
  const evAll = await ev.first().innerText();
  check(/0x8043a1e2/i.test(evAll) && /PSCP CORE0/.test(evAll) && /IRQ mode/.test(evAll) && /5G_MODEM_TEST_W26\.03\.1/.test(evAll), "registers, each core's PC, banked registers and the software version are read");
  check(/Queue Used\s*97/.test(evAll) && /nrrc_cell_select\.c line 902/.test(evAll) && /byte pool/i.test(evAll), "the running task's queue and the memory lists are summed up");
  check(/NR PHY/.test(evAll) && /threadx_assert\.c line 6169/.test(evAll), "the other cores that stopped with it are listed");
  check(/_1\.mem/.test(evAll) && /_2\.mem/.test(evAll) && /radio chip \(RFIC\) registers/.test(evAll), "the files the assert saved are listed, each with what it holds");
  check(/smp\.c line 167/.test(evAll), "asserts kept in modem memory are read from the memory dump");
  check(/Just before it in the log/.test(evText), "the messages logged just before the assert are listed");
  const strong = await page.locator('[data-crash-line="strong"]').allInnerTexts();
  check(
    strong.length >= 2 && strong.some((t) => /traceview\.dat/.test(t) && /12:14:00\.\d{3}/.test(t)) && strong.some((t) => /\.logel/.test(t)),
    `the assert is also found, timed, in the .logel and in Logel's decoded traces (${strong.length} lines)`,
  );
  check(!strong.some((t) => /Watch Dog Timer Expired|psAssert %s|Memory allocation Failed/.test(t)), "the firmware's own text in a memory dump is not taken for crashes");
  await page.getByRole("tab", { name: /^Files/ }).click();
  const assFile = await fileRow("2026_01_15_12_14_00_000.ass").innerText();
  const dumpFile = await fileRow("2026_01_15_12_14_00_000_1.mem").innerText();
  const rficFile = await fileRow("2026_01_15_12_14_00_000_2.mem").innerText();
  const emptyFile = await fileRow("2026_01_15_12_14_00_000_bt.cap").innerText();
  check(/Modem assert record/.test(assFile) && /Analysed/i.test(await page.locator("h3", { hasText: "Analysed" }).first().innerText()), "the .ass file is listed as an analysed assert record");
  check(/Modem memory dump/.test(dumpFile) && /RFIC register dump/.test(rficFile), "each dump file says what it is");
  check(/Empty \(0 bytes\)/.test(emptyFile) && (await page.getByText("Not needed").count()) === 0, "every file is analysed; empty ones say so, and none is left out as not needed");
  const crashCopy = await copied(/^Asserts/, 4);
  check(/nrrc_cell_select\.c/.test(crashCopy) && /Every core at that moment/.test(crashCopy) && /Registers before the assert/.test(crashCopy), "Copy report copies the Asserts page");
  await page.getByRole("tab", { name: /^All logs/ }).click();
  const fleetCopy = await copied(/^All logs/, 5);
  check(/Issues found in/.test(fleetCopy) && /2026_01_15_11_14_00_000_armlog/.test(fleetCopy), "Copy report copies the All logs page");
  const [dlFleet] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /HTML report/ }).first().click()]);
  const fleetFile = join(ROOT, "build", "fixtures", "report-fleet.html");
  await dlFleet.saveAs(fleetFile);
  const fv = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await fv.goto(pathToFileURL(fleetFile).href);
  await fv.locator("[data-log]").first().waitFor({ timeout: 20000 }).catch(() => {});
  const fvLogs = await fv.locator("[data-log]").count();
  await fv.locator('[data-log="2026_01_15_09_14_00_000_armlog"]').getByRole("button", { name: /Open this log/ }).click();
  const fvHead = await fv.locator("[data-verdict] h2").first().innerText({ timeout: 10000 }).catch(() => "");
  const fvExports = await fv.getByRole("button", { name: /Copy report|HTML report|Copy the summary|JSON/ }).count();
  check(fvLogs === 4 && /#62/.test(fvHead) && fvExports === 0, `the shared report holds every folder and opens each one (${fvLogs} logs, "${fvHead}")`);
  await fv.getByRole("tab", { name: /^All logs/ }).click();
  await fv.locator('[data-log="2026_01_15_12_14_00_000_armlog"]').getByRole("button", { name: /Open this log/ }).click();
  await fv.getByRole("tab", { name: /^Asserts/ }).click();
  const fvCrash = await fv.locator('[data-crash-event="assert"]').first().innerText({ timeout: 10000 }).catch(() => "");
  const fvText = await fv.content();
  check(/cell_idx < NRRC_MAX_CELL_NUM/.test(fvCrash) && !/msgview\.dat/.test(fvText), "the shared report keeps the Asserts page, without the file list");
  await fv.close();

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
