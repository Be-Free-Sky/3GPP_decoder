/**
 * HTML reports that keep the page's look outside the browser.
 *
 *  - emailHtml(): the content of the page the user is on, for the clipboard (no header or
 *    footer). Outlook (Word's HTML engine) keeps colours, borders and tables but drops flexbox,
 *    grid, CSS variables, rgba and SVG, so every style is inline, layout is tables, soft colours
 *    are solid hex and charts are PNG images.
 *  - viewerHtml(): the report to share as one .html file: the app itself (its code and styles,
 *    without the decoder engine) opened on this report, so it looks and works the same.
 *  - fileHtml(): a static fallback of the whole report, for the dev server where the app is
 *    not a single page that can be copied.
 */

import type { CaptureInfo, ContextItem, DecodeResult, Finding, MessageEntry, ModemSample, Report, Severity, TreeNode } from "@/lib/engine/types";
import { buildAreas, buildHeadline, type AreaStatus } from "@/lib/areas";
import { carriedTitle, directionLabel, fmtMs, protocolShort, worstSeverity } from "@/lib/format";
import { SKYWORTH_LOGO_SVG } from "@/components/app/skyworth-logo";
import { fleetOverview, logFacts, logVerdict, type FleetLog, type Tone as LogTone } from "@/lib/fleet";

export type ReportTab = "summary" | "flow" | "messages" | "radio" | "context" | "files";

export const TAB_TITLE: Record<ReportTab, string> = {
  summary: "Summary",
  flow: "Signalling flow",
  messages: "Messages",
  radio: "Radio",
  context: "Context",
  files: "Files",
};

// --- design tokens as solid colours (soft fills blended on white) ------------------------------

const C = {
  ink: "#0b1b34",
  ink2: "#34475f",
  muted: "#56677d",
  blue: "#0069c8",
  ocean: "#018abe",
  deep: "#02457a",
  line: "#e3e8ef",
  line2: "#d3dbe5",
  lane: "#c9d3df",
  panel: "#fcfdfe",
  panel2: "#f6f8fb",
  sunken: "#eef3f8",
  page: "#f4f8fb",
  accent: "#e6f0fa",
  bad: "#c21d3a",
  badInk: "#b3122f",
  badSoft: "#fae8ec",
  warn: "#c98500",
  warnInk: "#7a5000",
  warnSoft: "#f8efde",
  ok: "#12924a",
  okInk: "#08702a",
  okSoft: "#e4f5e4",
  okLine: "#b9e2c0",
  infoInk: "#02457a",
  infoSoft: "#e1f1f7",
};

type Tone = "bad" | "warn" | "ok" | "info" | "neutral" | "brand";

const TONE: Record<Tone, { bg: string; fg: string; mark: string }> = {
  bad: { bg: C.badSoft, fg: C.badInk, mark: C.bad },
  warn: { bg: C.warnSoft, fg: C.warnInk, mark: C.warn },
  ok: { bg: C.okSoft, fg: C.okInk, mark: C.ok },
  info: { bg: C.infoSoft, fg: C.infoInk, mark: C.ocean },
  neutral: { bg: C.sunken, fg: C.ink2, mark: C.line2 },
  brand: { bg: C.accent, fg: C.blue, mark: C.blue },
};

const SEV_TONE: Record<Severity, Tone> = { critical: "bad", warning: "warn", ok: "ok", info: "info" };
const SEV_WORD: Record<Severity, string> = { critical: "Failure", warning: "Warning", ok: "OK", info: "Note" };
const SEV_GLYPH: Record<Severity, string> = { critical: "&#10005;", warning: "!", ok: "&#10003;", info: "i" };
const AREA_TONE: Record<AreaStatus, Tone> = { bad: "bad", warn: "warn", ok: "ok", none: "neutral" };

const FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";
const MONO = "font-family:Consolas,'Courier New',monospace;";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// --- building blocks ---------------------------------------------------------------------------

function chip(text: string, tone: Tone = "neutral", mono = false) {
  const t = TONE[tone];
  return `<span style="display:inline-block;background:${t.bg};color:${t.fg};border-radius:999px;padding:2px 9px;margin:0 4px 4px 0;font-size:12px;font-weight:700;white-space:nowrap;${mono ? MONO : FONT}">${text}</span>`;
}

function table(inner: string, style = "") {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;${style}">${inner}</table>`;
}

function card(inner: string, opts: { top?: string; pad?: string; bg?: string } = {}) {
  return table(
    `<tr><td style="padding:${opts.pad ?? "16px 18px"};background:${opts.bg ?? C.panel};border:1px solid ${C.line};border-radius:16px;${
      opts.top ? `border-top:4px solid ${opts.top};` : ""
    }">${inner}</td></tr>`,
    "margin:0 0 14px 0;",
  );
}

/** A small coloured square or circle with a glyph, as a table cell so Outlook keeps its size. */
function tile(glyph: string, size: number, bg: string, fg: string, radius: number) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td width="${size}" height="${size}" align="center" valign="middle" bgcolor="${bg}" style="width:${size}px;height:${size}px;background:${bg};color:${fg};border-radius:${radius}px;${FONT}font-size:${Math.round(size / 2)}px;font-weight:700;line-height:${size}px;mso-line-height-rule:exactly">${glyph}</td></tr></table>`;
}

function head(title: string, sub?: string, glyph = "&#9670;", aside = "") {
  return `${table(
    `<tr><td width="38" valign="top" style="padding:0 10px 0 0">${tile(glyph, 28, C.blue, "#ffffff", 8)}</td>
     <td valign="middle" style="${FONT}"><div style="font-size:16px;font-weight:700;color:${C.ink}">${esc(title)}</div>${
       sub ? `<div style="font-size:13px;color:${C.muted};margin-top:2px">${esc(sub)}</div>` : ""
     }</td>${aside ? `<td align="right" valign="top" style="${FONT}">${aside}</td>` : ""}</tr>`,
  )}<div style="height:12px;line-height:12px;font-size:1px">&nbsp;</div>`;
}

function grid(cells: string[], cols: number, gap = 12) {
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const tds = cells
      .slice(i, i + cols)
      .map((c, k) => `<td width="${Math.floor(100 / cols)}%" valign="top" style="padding:0 ${k < cols - 1 ? gap / 2 : 0}px 0 ${k > 0 ? gap / 2 : 0}px">${c}</td>`);
    while (tds.length < cols) tds.push(`<td width="${Math.floor(100 / cols)}%"></td>`);
    rows.push(`<tr>${tds.join("")}</tr>`);
  }
  return table(rows.join(""));
}

function box(inner: string, tone: Tone) {
  const t = TONE[tone];
  return table(
    `<tr><td style="background:${t.bg};border:1px solid ${tone === "ok" ? C.okLine : C.line};border-radius:12px;padding:10px 14px;${FONT}font-size:14px;color:${C.ink}">${inner}</td></tr>`,
    "margin:10px 0 0 0;",
  );
}

function para(text: string, style = "") {
  return `<p style="margin:6px 0 0 0;${FONT}font-size:14px;line-height:1.55;color:${C.ink2};${style}">${text}</p>`;
}

function dataTable(headers: string[], rows: string[][], align: ("left" | "right")[] = []) {
  const th = headers
    .map((h, k) => `<th align="${align[k] ?? "left"}" style="padding:8px 10px;background:${C.panel2};border-bottom:1px solid ${C.line};${FONT}font-size:12px;font-weight:600;color:${C.muted}">${h}</th>`)
    .join("");
  const tr = rows
    .map(
      (r, i) =>
        `<tr>${r
          .map((c, k) => `<td align="${align[k] ?? "left"}" valign="top" style="padding:7px 10px;${i % 2 ? `background:${C.panel2};` : ""}${FONT}font-size:13px;color:${C.ink}">${c}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return table(`<tr>${th}</tr>${tr}`, `border:1px solid ${C.line};border-radius:12px;`);
}

const mono = (s: string, color: string = C.ink) => `<span style="${MONO}font-size:12.5px;color:${color}">${s}</span>`;
const ref = (i: number) => `<span style="${MONO}font-size:12px;font-weight:700;color:${C.blue}">#${i + 1}</span>`;
const space = (h: number) => `<div style="height:${h}px;line-height:${h}px;font-size:1px">&nbsp;</div>`;

// --- charts --------------------------------------------------------------------------------------

type Metric = "rsrp" | "rsrq" | "sinr";
const METRIC: Record<Metric, { title: string; unit: string; step: number; refs: [number, string][] }> = {
  rsrp: { title: "Serving RSRP", unit: "dBm", step: 10, refs: [[-80, "Excellent above -80"], [-100, "Fair above -100"], [-110, "Cell edge -110"]] },
  rsrq: { title: "Serving RSRQ", unit: "dB", step: 5, refs: [[-10, "Good above -10"], [-15, "Poor below -15"]] },
  sinr: { title: "Serving SINR", unit: "dB", step: 5, refs: [[13, "Good above 13"], [0, "Poor below 0"]] },
};

export interface ChartSpec {
  id: string;
  svg: string;
  w: number;
  h: number;
}

function tsMs(ts?: string | null) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(ts ?? "");
  return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Number((m[4] ?? "0").padEnd(3, "0")) : null;
}

/** A line chart as standalone SVG (explicit colours and fonts, no CSS). */
function chartSvg(metric: Metric, pts: { x: number; v: number }[], xLabels: [string, string], w = 700, h = 190) {
  const m = METRIC[metric];
  const pad = { l: 46, r: 14, t: 14, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const vals = pts.map((p) => p.v).concat(m.refs.map((r) => r[0]));
  const lo = Math.floor((Math.min(...vals) - m.step / 2) / m.step) * m.step;
  let hi = Math.ceil((Math.max(...vals) + m.step / 2) / m.step) * m.step;
  if (hi - lo < m.step * 2) hi = lo + m.step * 2;
  const x0 = pts[0].x;
  const x1 = Math.max(pts[pts.length - 1].x, x0 + 1);
  const X = (x: number) => pad.l + (pts.length === 1 ? iw / 2 : ((x - x0) / (x1 - x0)) * iw);
  const Y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * ih;
  const font = `font-family="Segoe UI, Arial, sans-serif"`;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fcfdfe"/>`];
  for (let v = lo; v <= hi; v += m.step) {
    out.push(`<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e4ebf2" stroke-width="1"/>`);
    out.push(`<text x="${pad.l - 8}" y="${Y(v) + 3.5}" text-anchor="end" font-size="10.5" fill="${C.muted}" ${font}>${v}</text>`);
  }
  for (const [y, label] of m.refs) {
    if (y <= lo || y >= hi) continue;
    out.push(`<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(y)}" y2="${Y(y)}" stroke="#9aa8b8" stroke-width="1"/>`);
    out.push(`<text x="${w - pad.r}" y="${Y(y) - 4}" text-anchor="end" font-size="10" fill="${C.muted}" ${font}>${esc(label)}</text>`);
  }
  let d = "";
  pts.forEach((p, k) => {
    const gap = k > 0 && p.x - pts[k - 1].x > 3000 && x1 - x0 > 10000;
    d += `${k === 0 || gap ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.v).toFixed(1)}`;
  });
  out.push(`<path d="${d}" fill="none" stroke="${C.blue}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  pts.forEach((p, k) => {
    const alone = (k === 0 || p.x - pts[k - 1].x > 3000) && (k === pts.length - 1 || pts[k + 1].x - p.x > 3000) && x1 - x0 > 10000;
    if (pts.length <= 60 || alone) out.push(`<circle cx="${X(p.x)}" cy="${Y(p.v)}" r="3.5" fill="${C.blue}" stroke="#ffffff" stroke-width="2"/>`);
  });
  out.push(`<text x="${pad.l}" y="${h - 6}" font-size="10.5" fill="${C.muted}" ${font}>${esc(xLabels[0])}</text>`);
  out.push(`<text x="${w - pad.r}" y="${h - 6}" text-anchor="end" font-size="10.5" fill="${C.muted}" ${font}>${esc(xLabels[1])}</text>`);
  out.push("</svg>");
  return out.join("");
}

interface Ctx {
  /** markup for a chart: inline SVG (file) or a placeholder replaced by a PNG (email) */
  chart: (c: ChartSpec) => string;
  file: boolean;
}

// --- summary -------------------------------------------------------------------------------------

function findingHtml(f: Finding) {
  const t = SEV_TONE[f.severity];
  const meta = [
    chip(SEV_WORD[f.severity], t),
    f.ref ? chip(esc(f.ref), "neutral", true) : "",
    f.via ? chip(`in ${esc(f.via)}`) : "",
    f.count && f.count > 1 ? chip(`x${f.count}`) : "",
    ...(f.refs ?? []).slice(0, 8).map((r) => chip(`#${r + 1}`, "brand", true)),
  ].join("");
  const causes = f.causes?.length
    ? box(`<b style="color:${C.ink}">Likely causes</b><br>${f.causes.map((c) => `&#8226; ${esc(c)}`).join("<br>")}`, "neutral")
    : "";
  const checks = f.checks?.length
    ? box(`<b style="color:${C.okInk}">What to check</b><br>${f.checks.map((c) => `&#8226; ${esc(c)}`).join("<br>")}`, "ok")
    : "";
  return card(
    `<div style="${FONT}font-size:15px;font-weight:700;color:${C.ink}">${esc(f.title)}</div>${f.detail ? para(esc(f.detail)) : ""}${space(8)}${meta}${
      causes && checks ? grid([causes, checks], 2) : causes + checks
    }`,
    { top: TONE[t].mark, pad: "14px 16px" },
  );
}

function summaryHtml(report: Report) {
  const s = report.session;
  if (!s) return messagesHtml(report, 0);
  const h = buildHeadline(report);
  const tone: Tone = h.overall === "bad" ? "bad" : h.overall === "warn" ? "warn" : "ok";
  const k = s.kpis;
  const meta = [
    k.durationMs != null ? `log of <b>${fmtMs(k.durationMs)}</b>` : "",
    `<b>${k.messages}</b> ${k.messages === 1 ? "message" : "messages"}${k.failedDecode ? `, ${k.failedDecode} not decoded` : ""}`,
    k.rats.join(" and "),
    k.handovers ? `${k.handovers} handover${k.handovers === 1 ? "" : "s"}` : "",
    h.refs.length ? `evidence ${h.refs.slice(0, 4).map(ref).join(" ")}` : "",
  ].filter(Boolean);
  const out: string[] = [];
  out.push(
    card(
      `${chip(esc(h.kick), tone)}<div style="${FONT}font-size:24px;line-height:1.3;font-weight:700;color:${C.ink};margin:8px 0 0 0">${esc(h.head)}</div>${
        h.detail ? para(esc(h.detail), "font-size:15px") : ""
      }${h.todo ? box(`<b style="color:${C.okInk}">&#10003; What to do</b>&nbsp;&nbsp;${esc(h.todo)}`, "ok") : ""}<p style="margin:10px 0 0 0;${FONT}font-size:13.5px;color:${C.ink2}">${meta.join(
        ` &nbsp;<span style="color:${C.line2}">|</span>&nbsp; `,
      )}</p>`,
      { top: TONE[tone].mark, pad: "20px 22px" },
    ),
  );
  const areas = buildAreas(report).map((a) => {
    const t = AREA_TONE[a.status];
    return card(
      `${table(
        `<tr><td style="${FONT}font-size:15px;font-weight:700;color:${C.ink}">${esc(a.title)}</td><td align="right">${chip(esc(a.word), t)}</td></tr>`,
      )}${para(esc(a.say), `color:${C.ink}`)}${a.todo && a.status !== "ok" ? box(`<b>What to do:</b> ${esc(a.todo)}`, "neutral") : ""}`,
      { top: TONE[t].mark, pad: "14px 16px" },
    );
  });
  out.push(grid(areas, 2));
  if (s.narrative.steps.length) {
    const rows = s.narrative.steps
      .map((st) => {
        const t = TONE[SEV_TONE[st.severity]];
        return `<tr><td width="96" style="padding:6px 0;${MONO}font-size:12.5px;color:${C.ink2}">${esc(report.messages[st.i]?.timestamp ?? `#${st.i + 1}`)}</td>
          <td width="34" style="padding:6px 0">${tile(SEV_GLYPH[st.severity], 22, t.bg, t.fg, 11)}</td>
          <td style="padding:6px 0;${FONT}font-size:14px;color:${C.ink}">${esc(st.text)}</td></tr>`;
      })
      .join("");
    out.push(card(head("What happened, in order", "The procedures and failures that matter, in log order.", "&#9719;") + table(rows)));
  }
  const issues = s.findings.filter((f) => f.severity === "critical" || f.severity === "warning");
  const notes = s.findings.filter((f) => f.severity === "info" || f.severity === "ok");
  if (issues.length || notes.length) {
    out.push(
      card(
        head("Findings", "Every failure and warning, with likely causes and the checks to run.", "&#9776;") +
          issues.map(findingHtml).join("") +
          (notes.length ? `<div style="${FONT}font-size:13px;font-weight:700;color:${C.muted};margin:6px 0 8px">Notes</div>${notes.map(findingHtml).join("")}` : ""),
      ),
    );
  }
  if (s.procedures.length) {
    const WORD: Record<string, [string, Tone]> = {
      success: ["Completed", "ok"],
      failure: ["Failed", "bad"],
      "no-answer": ["No answer in log", "warn"],
      retried: ["Restarted", "warn"],
      open: ["Open", "info"],
    };
    out.push(
      card(
        head("Procedures", "Each 3GPP procedure the log starts, and how it ended.", "&#10003;") +
          dataTable(
            ["Procedure", "Result", "Duration", "Messages"],
            s.procedures.map((p) => [
              `<b>${esc(p.name)}</b>`,
              chip(WORD[p.status][0], WORD[p.status][1]),
              mono(p.durationMs != null ? fmtMs(p.durationMs) : "n/a", C.ink2),
              p.steps.slice(0, 6).map(ref).join(" "),
            ]),
          ),
      ),
    );
  }
  if (report.capture?.files?.length) out.push(filesCard(report.capture, false));
  return out.join("");
}

// --- signalling flow ------------------------------------------------------------------------------

const LANE_ROLE: Record<string, string> = {
  UE: "Device", eNB: "LTE RAN", gNB: "NR RAN", RNC: "WCDMA RAN", MME: "EPC core", AMF: "5G core",
  "MSC / SGSN": "2G / 3G core", "Peer RAN": "Neighbour", "gNB-DU": "Distributed unit", "gNB-CU": "Central unit", Network: "Network",
};

function flowHtml(report: Report) {
  const s = report.session;
  if (!s) return "";
  const lanes = s.lanes.length ? s.lanes : ["UE", "Network"];
  const n = lanes.length;
  const laneLine = `border-right:1px solid ${C.lane};`;
  const halfW = `${(100 / (2 * n)).toFixed(2)}%`;
  const headRow = `<tr><td width="96" style="padding:8px;${FONT}font-size:12px;font-weight:600;color:${C.muted};background:${C.panel2};border-bottom:1px solid ${C.line}">Time</td>${lanes
    .map(
      (l) =>
        `<td colspan="2" align="center" style="padding:8px 4px;background:${C.panel2};border-bottom:1px solid ${C.line};${FONT}"><div style="font-size:13px;font-weight:700;color:${C.ink}">${esc(l)}</div><div style="font-size:11px;color:${C.muted}">${esc(LANE_ROLE[l] ?? "")}</div></td>`,
    )
    .join("")}</tr>`;
  const sizer = `<tr><td width="96" style="font-size:1px;line-height:1px">&nbsp;</td>${Array.from({ length: 2 * n }, () => `<td width="${halfW}" style="font-size:1px;line-height:1px">&nbsp;</td>`).join("")}</tr>`;
  const filler = (from: number, to: number) => {
    let h = "";
    for (let j = from; j < to; j++) h += `<td style="${j % 2 === 0 ? laneLine : ""}font-size:1px">&nbsp;</td>`;
    return h;
  };
  const rows = s.events
    .map((e) => {
      const time = `<td valign="middle" style="padding:6px 8px;${MONO}font-size:11.5px;color:${C.ink2};border-bottom:1px solid ${C.panel2}">${esc(e.ts ?? `#${e.i + 1}`)}<br><span style="color:${C.muted}">#${e.i + 1}</span></td>`;
      if (e.error) return `<tr>${time}<td colspan="${2 * n}" align="center" style="${FONT}font-size:12.5px;font-weight:600;color:${C.badInk}">Decode failed</td></tr>`;
      let a = Math.max(0, lanes.indexOf(e.from ?? ""));
      let b = Math.max(0, lanes.indexOf(e.to ?? ""));
      if (a === b) b = a === n - 1 ? a - 1 : a + 1;
      const right = b > a;
      [a, b] = [Math.min(a, b), Math.max(a, b)];
      const bad = e.status === "failure";
      const warn = e.status === "warning";
      const nested = e.sub != null;
      const color = bad ? C.bad : warn ? C.warn : nested ? C.ocean : C.blue;
      const label = `${bad ? "&#10005; " : warn ? "! " : ""}${esc(e.title)}${e.bcast ? ` <span style="font-weight:400;color:${C.muted}">(broadcast)</span>` : ""}`;
      const line = `<td style="border-bottom:2px ${nested ? "dashed" : "solid"} ${color};font-size:1px;line-height:1px">&nbsp;</td>`;
      const tip = `<td width="10" style="${FONT}font-size:11px;line-height:11px;color:${color};padding:0">${right ? "&#9654;" : "&#9664;"}</td>`;
      const arrow = `<td colspan="${2 * (b - a)}" valign="middle" style="padding:4px 0;${bad ? `background:${C.badSoft};` : ""}">
        <div style="text-align:center;${FONT}font-size:12.5px;font-weight:600;color:${bad ? C.badInk : nested ? C.infoInk : C.ink};padding:0 6px 3px">${label}</div>
        ${table(`<tr>${right ? line + tip : tip + line}</tr>`)}
        ${e.via ? `<div style="text-align:center;${FONT}font-size:10.5px;color:${C.muted}">via ${esc(e.via)}</div>` : ""}</td>`;
      return `<tr>${time}${filler(0, 2 * a + 1)}${arrow}${filler(2 * b + 1, 2 * n)}</tr>`;
    })
    .join("");
  const legend = `${chip("&#8212; Message", "brand")}${chip("- - NAS inside RRC", "info")}${chip("&#8212; Failure", "bad")}`;
  return card(
    head("Signalling flow", "Every message between the device, the radio network and the core, in log order.", "&#8644;", legend) +
      table(sizer + headRow + rows, `border:1px solid ${C.line};border-radius:12px;table-layout:fixed;`),
  );
}

// --- messages -------------------------------------------------------------------------------------

function treeRows(node: TreeNode, depth: number, out: string[], limit: number) {
  if (out.length >= limit) return;
  const kids = node.c ?? [];
  const label = node.l || node.k;
  const value = node.chl && kids.length ? node.chl : node.v;
  const hint = node.h;
  const q = node.q;
  const hintColor = q === "excellent" ? C.okInk : q === "good" ? C.blue : q === "fair" ? C.warnInk : q === "poor" ? "#b4480d" : q === "bad" ? C.badInk : C.ink2;
  out.push(
    `<tr><td valign="top" style="padding:3px 8px 3px ${8 + depth * 14}px;${FONT}font-size:12.5px;color:${C.ink};${kids.length ? "font-weight:600;" : ""}">${esc(label)}${
      node.r ? ` <span style="${MONO}font-size:10px;color:${C.muted}">${esc(node.r)}</span>` : ""
    }</td><td valign="top" style="padding:3px 8px;${MONO}font-size:12px;color:${node.chl && kids.length ? C.blue : C.ink};word-break:break-word;overflow-wrap:anywhere">${esc(value ?? "")}${
      node.n != null ? `<span style="${FONT}color:${C.muted}"> (${node.n} items)</span>` : ""
    }</td><td valign="top" style="padding:3px 8px;${FONT}font-size:12px;color:${hintColor}">${esc(hint ?? "")}</td></tr>`,
  );
  for (const c of kids) treeRows(c, depth + 1, out, limit);
}

function countNodes(n: TreeNode): number {
  return 1 + (n.c ?? []).reduce((a, c) => a + countNodes(c), 0);
}

function hexHtml(hex: string) {
  const bytes = hex.match(/../g) ?? [];
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const b = bytes.slice(i, i + 16);
    const ascii = b.map((x) => {
      const c = parseInt(x, 16);
      return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
    });
    rows.push(`${i.toString(16).padStart(4, "0")}  ${b.join(" ").toUpperCase().padEnd(47)}  ${ascii.join("")}`);
  }
  return `<pre style="margin:0;padding:12px 14px;background:${C.panel2};border:1px solid ${C.line};border-radius:12px;${MONO}font-size:12px;line-height:1.6;color:${C.ink};white-space:pre-wrap">${esc(rows.join("\n"))}</pre>`;
}

function decodeHtml(r: DecodeResult) {
  if (!r.tree) return r.text ? `<pre style="${MONO}font-size:12px;white-space:pre-wrap;margin:0">${esc(r.text)}</pre>` : "";
  const total = countNodes(r.tree);
  if (total > 4000 && r.text) {
    return `${para(`${total} fields: shown in the 3GPP notation.`)}${space(6)}<pre style="margin:0;padding:12px 14px;background:${C.panel2};border:1px solid ${C.line};border-radius:12px;${MONO}font-size:11.5px;line-height:1.5;color:${C.ink};white-space:pre-wrap">${esc(r.text)}</pre>`;
  }
  const rows: string[] = [];
  treeRows(r.tree, 0, rows, 4000);
  return dataTableRaw(["Field", "Value", "Meaning"], rows.join(""));
}

function dataTableRaw(headers: string[], rows: string, widths: string[] = ["38%", "30%", "32%"]) {
  const th = headers
    .map((h, k) => `<th align="left" width="${widths[k] ?? ""}" style="padding:7px 8px;background:${C.panel2};border-bottom:1px solid ${C.line};${FONT}font-size:12px;font-weight:600;color:${C.muted}">${h}</th>`)
    .join("");
  return table(`<tr>${th}</tr>${rows}`, `border:1px solid ${C.line};border-radius:12px;table-layout:fixed;`);
}

function highlightsHtml(r: DecodeResult) {
  if (!r.highlights.length) return "";
  const cells = r.highlights.map((h) =>
    table(
      `<tr><td style="padding:9px 12px;background:${C.panel2};border:1px solid ${C.line};border-radius:12px;${FONT}"><div style="font-size:12px;color:${C.muted}">${esc(h.label)}</div><div style="font-size:14.5px;font-weight:700;color:${C.ink};margin-top:2px">${esc(
        h.value,
      )}</div>${h.hint ? `<div style="font-size:12px;color:${C.ink2};margin-top:1px">${esc(h.hint)}</div>` : ""}</td></tr>`,
      "margin:0 0 10px 0;",
    ),
  );
  return grid(cells, 3, 10);
}

const PEERS: Record<string, [string, string]> = {
  "LTE RRC": ["UE", "eNB"], "NB-IoT RRC": ["UE", "eNB"], "NR RRC": ["UE", "gNB"], "WCDMA RRC": ["UE", "RNC"], "EPS NAS": ["UE", "MME"], "5GS NAS": ["UE", "AMF"],
};

export function messageHtml(entry: MessageEntry, total: number) {
  const r = entry.result;
  const sev = worstSeverity(r);
  const tone: Tone = !r.ok || sev === "critical" ? "bad" : sev === "warning" ? "warn" : r.findings.some((f) => f.severity === "ok") ? "ok" : "info";
  const kick = !r.ok ? "Could not decode" : tone === "bad" ? "Failure in this message" : tone === "warn" ? "Worth a look" : "Decoded";
  const pair = PEERS[r.protocol.family ?? ""];
  const peers = pair ? (r.direction === "DL" ? `${pair[1]} to ${pair[0]}` : r.direction === "UL" ? `${pair[0]} to ${pair[1]}` : "") : "";
  const det = r.detection;
  const detText = det?.mode === "log" ? "Channel logged by the modem" : det?.mode === "manual" ? "Protocol chosen by hand" : det?.mode === "hint" ? "Protocol from the log header" : det ? `Auto-detected, ${det.confidence} confidence` : "";
  const todo = r.findings.find((f) => (f.severity === "critical" || f.severity === "warning") && f.checks?.length)?.checks?.[0];
  const out: string[] = [];
  out.push(
    card(
      `${chip(kick, tone)} <span style="${MONO}font-size:12.5px;color:${C.muted}">Message ${entry.index + 1} of ${total}${entry.timestamp ? ` &nbsp; ${esc(entry.timestamp)}` : ""}</span>
      <div style="${FONT}font-size:22px;font-weight:700;color:${C.ink};margin:8px 0 6px">${esc(r.ok ? r.message?.title : "Could not decode this message")}</div>${
        r.ok
          ? [chip(esc(protocolShort(r)), "brand"), chip(esc(peers ? `${directionLabel(r)}, ${peers}` : directionLabel(r))), chip(`${r.bytes} bytes`), r.security ? chip(esc(r.security.label ?? "Security protected")) : "", detText ? chip(detText) : ""].join("")
          : ""
      }${r.ok ? (r.summary ? para(esc(r.summary), "font-size:15px") : "") : para(esc(r.error))}${todo ? box(`<b style="color:${C.okInk}">&#10003; What to do</b>&nbsp;&nbsp;${esc(todo)}`, "ok") : ""}${r.warnings
        .map((w) => box(`! ${esc(w)}`, "warn"))
        .join("")}${entry.header ? `<p style="margin:10px 0 0;${MONO}font-size:11.5px;color:${C.muted}">${esc(entry.header)}</p>` : ""}`,
      { top: TONE[tone].mark, pad: "18px 20px" },
    ),
  );
  if (r.findings.length) out.push(card(head("Analysis", "What this message means for the call, with likely causes and checks.", "&#9776;") + r.findings.map(findingHtml).join("")));
  if (r.ok && r.highlights.length) out.push(card(head("Key fields", "The values that matter for troubleshooting.", "i") + highlightsHtml(r)));
  for (const e of r.embedded) {
    const x = e.result;
    out.push(
      card(
        head(x.ok ? x.message?.title ?? "Embedded content" : "Embedded content", `Carried inside this message in ${e.field}`, "&#9638;", x.ok ? chip(esc(protocolShort(x)), "brand") : "") +
          (x.ok
            ? `${x.summary ? para(esc(x.summary)) : ""}${x.findings.map(findingHtml).join("")}${space(8)}${highlightsHtml(x)}${decodeHtml(x)}`
            : para(esc(x.error))),
      ),
    );
  }
  if (r.ok) out.push(card(head("Full decode", "Every field as the 3GPP specification names it.", "&#9638;") + decodeHtml(r)));
  out.push(card(head("Bytes", `${r.bytes} bytes as logged.`, "#") + hexHtml(r.hex)));
  return out.join("");
}

function messageListHtml(report: Report, selected: number, limit = 400) {
  const rows = report.messages.slice(0, limit).map((m) => {
    const r = m.result;
    const sev = worstSeverity(r);
    const carried = r.ok ? carriedTitle(r) : null;
    const sel = m.index === selected;
    return [
      `<span style="${MONO}font-size:12px;color:${C.muted}">${m.index + 1}</span>`,
      mono(esc(m.timestamp ?? ""), C.ink2),
      `${sel ? "<b>" : ""}${esc(r.ok ? r.message?.title : "Could not decode")}${sel ? "</b>" : ""}${carried ? ` <span style="color:${C.blue}">&#183; ${esc(carried)}</span>` : ""}`,
      `<span style="color:${C.ink2}">${esc(r.ok ? protocolShort(r) : `${r.bytes} bytes`)}</span>`,
      sev ? chip(SEV_WORD[sev], SEV_TONE[sev]) : "",
    ];
  });
  return (
    dataTable(["#", "Time", "Message", "Protocol", ""], rows) +
    (report.messages.length > limit ? para(`... and ${report.messages.length - limit} more messages.`) : "")
  );
}

function messagesHtml(report: Report, selected: number) {
  const entry = report.messages[selected] ?? report.messages[0];
  if (!entry) return "";
  const list = report.messages.length > 1 ? card(head("Messages", `${report.messages.length} messages. The one below is message ${entry.index + 1}.`, "&#8801;") + messageListHtml(report, entry.index)) : "";
  return list + messageHtml(entry, report.messages.length);
}

// --- radio ----------------------------------------------------------------------------------------

function radioHtml(report: Report, ctx: Ctx) {
  const s = report.session;
  if (!s) return "";
  const out: string[] = [];
  const modem = s.radio.modem;
  const metrics = (["rsrp", "rsrq", "sinr"] as Metric[]);
  if (modem?.points.length) {
    const cell = modem.cells?.[0];
    const tiles = [
      cell ? statTile("Cell", `PCI ${cell.pci}`, `${cell.arfcn != null ? `NR-ARFCN ${cell.arfcn}` : ""}${cell.band ? `, n${cell.band}` : ""}`) : "",
      ...metrics.map((k) => (modem[k] ? statTile(`${METRIC[k].title} (median)`, `${modem[k]!.median} ${METRIC[k].unit}`, `${modem[k]!.min} to ${modem[k]!.max}`) : "")),
    ].filter(Boolean);
    out.push(card(head("Serving cell, from the modem", "Measured by the modem itself (its traces and AT+CESQ), many times a second.", "&#8767;") + grid(tiles, Math.min(4, tiles.length), 10)));
    for (const k of metrics) {
      const pts = modem.points
        .map((p: ModemSample) => ({ x: tsMs(p.ts), v: p[k] }))
        .filter((p): p is { x: number; v: number } => p.x !== null && typeof p.v === "number");
      if (!pts.length) continue;
      const first = modem.points.find((p) => typeof p[k] === "number")?.ts ?? "";
      const last = [...modem.points].reverse().find((p) => typeof p[k] === "number")?.ts ?? "";
      const vals = pts.map((p) => p.v);
      out.push(
        card(
          head(`${METRIC[k].title} (${METRIC[k].unit})`, `${pts.length} samples, min ${Math.min(...vals)}, max ${Math.max(...vals)}, last ${vals[vals.length - 1]} ${METRIC[k].unit}`, "&#8767;") +
            ctx.chart({ id: `modem-${k}`, svg: chartSvg(k, pts, [first ?? "", last ?? ""]), w: 700, h: 190 }),
        ),
      );
    }
  }
  const mr = s.radio.points;
  if (mr.length) {
    for (const k of metrics) {
      const pts = mr.map((p, i) => ({ x: i, v: p[k] })).filter((p): p is { x: number; v: number } => typeof p.v === "number");
      if (!pts.length) continue;
      const vals = pts.map((p) => p.v);
      out.push(
        card(
          head(`${METRIC[k].title} (${METRIC[k].unit}), from Measurement Reports`, `${pts.length} reports, min ${Math.min(...vals)}, max ${Math.max(...vals)}`, "&#8767;") +
            ctx.chart({ id: `mr-${k}`, svg: chartSvg(k, pts, [mr[0].ts ?? "#1", mr[mr.length - 1].ts ?? `#${mr.length}`]), w: 700, h: 190 }),
        ),
      );
    }
    out.push(
      card(
        head("Measurement reports", "Serving cell and the strongest neighbours in each report.", "&#9638;") +
          dataTable(
            ["Message", "Time", "RAT", "RSRP", "RSRQ", "SINR", "Neighbours"],
            mr.map((p) => [
              ref(p.i),
              mono(esc(p.ts ?? "n/a"), C.ink2),
              esc(p.rat ?? "n/a"),
              mono(String(p.rsrp ?? "n/a")),
              mono(String(p.rsrq ?? "n/a")),
              mono(String(p.sinr ?? "n/a")),
              esc(p.neighbors.length ? p.neighbors.slice(0, 3).map((n) => `${n.rat} PCI ${n.pci}${n.rsrp != null ? ` ${n.rsrp} dBm` : ""}`).join(", ") : "none"),
            ]),
            ["left", "left", "left", "right", "right", "right", "left"],
          ),
      ),
    );
  }
  if (!out.length) out.push(card(para("No radio measurements in this log.")));
  return out.join("");
}

function statTile(label: string, value: string, sub: string) {
  return table(
    `<tr><td style="padding:9px 12px;background:${C.panel2};border:1px solid ${C.line};border-radius:12px;${FONT}"><div style="font-size:12px;color:${C.muted}">${esc(label)}</div><div style="font-size:15px;font-weight:700;color:${C.ink};margin-top:2px">${esc(
      value,
    )}</div><div style="font-size:12px;color:${C.ink2}">${esc(sub)}</div></td></tr>`,
  );
}

// --- context --------------------------------------------------------------------------------------

function contextHtml(report: Report) {
  const s = report.session;
  if (!s) return "";
  const groups: [keyof typeof s.context, string, string][] = [
    ["network", "Network", "Operator, tracking area and cells."],
    ["ue", "UE identity", "Subscriber and temporary identities."],
    ["radio", "Radio", "Bands, bandwidth and mobility targets."],
    ["data", "Data session", "APN or DNN, addresses and QoS."],
    ["device", "Device and log", "Modem software and the logging tool."],
  ];
  const cards = groups
    .filter(([k]) => (s.context[k] ?? []).length || k !== "device")
    .map(([k, title, sub]) => {
      const items: ContextItem[] = s.context[k] ?? [];
      const body = items.length
        ? dataTable(
            ["Item", "Value", "From"],
            items.map((it) => [
              `<span style="color:${C.muted}">${esc(it.label)}</span>`,
              `${mono(`<b>${esc(it.value)}</b>`)}${it.hint ? `<div style="${FONT}font-size:12px;color:${C.ink2}">${esc(it.hint)}</div>` : ""}`,
              it.from != null ? ref(it.from) : `<span style="${FONT}font-size:11px;color:${C.muted}">modem</span>`,
            ]),
          )
        : para("Nothing in this log.");
      return card(head(title, sub, "i") + body);
    });
  return grid(cards, 2);
}

// --- files ----------------------------------------------------------------------------------------

const sizeText = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);

function filesCard(cap: CaptureInfo, all: boolean) {
  const files = cap.files ?? [];
  const ROLE = { analysed: ["Analysed", "ok"], info: ["Read for information", "info"], skipped: ["Not needed", "neutral"] } as const;
  const shown = all ? files : files.filter((f) => f.role !== "skipped");
  const rows = shown.map((f) => [
    `${mono(`<b>${esc(f.name)}</b>`)}<div style="${FONT}font-size:12.5px;color:${C.ink2}">${esc(f.reason)}</div>${f.detail ? `<div style="${FONT}font-size:12.5px;color:${C.ink}">${esc(f.detail)}</div>` : ""}`,
    chip(ROLE[f.role][0], ROLE[f.role][1]),
    esc(f.label),
    mono(sizeText(f.size), C.ink2),
  ]);
  const used = files.filter((f) => f.role === "analysed").length;
  const info = files.filter((f) => f.role === "info").length;
  return card(
    head(
      all ? `Files in ${cap.name ?? "this log"}` : "Files in this log",
      `${files.length} files: ${used} analysed, ${info} read for information, ${files.length - used - info} not needed.`,
      "&#9636;",
    ) + dataTable(["File", "Use", "Kind", "Size"], rows, ["left", "left", "left", "right"]),
  );
}

function filesHtml(report: Report) {
  const cap = report.capture;
  if (!cap) return card(para("This decode did not come from a log capture."));
  const out = [filesCard(cap, true)];
  const ip = cap.ip;
  if (ip) {
    const RC: Record<number, string> = { 0: "Answered", 1: "Format error", 2: "Server failure", 3: "No such name", 4: "Not implemented", 5: "Refused" };
    out.push(
      card(
        head("IP traffic", `${ip.packets} packets from ${ip.first ?? "?"} to ${ip.last ?? "?"}: ${ip.ul} up, ${ip.dl} down, ${ip.tcp} TCP, ${ip.udp} UDP, ${ip.icmp} ICMP.`, "&#9675;") +
          (ip.dns.length
            ? dataTable(
                ["Time", "DNS lookup", "Type", "Result", "Answer time"],
                ip.dns.map((q) => {
                  const bad = q.answered === false || (q.rcode != null && q.rcode !== 0);
                  const word = q.answered === false ? "No answer" : q.answered ? `${RC[q.rcode ?? 0] ?? `Error ${q.rcode}`}${q.rcode === 0 ? `, ${q.answers} records` : ""}` : "Capture ended";
                  return [mono(esc(q.ts), C.ink2), mono(`<b>${esc(q.name)}</b>`), esc(q.type), chip(word, bad ? "bad" : q.answered ? "ok" : "neutral"), mono(q.rttMs != null ? `${q.rttMs} ms` : "", C.ink2)];
                }),
                ["left", "left", "left", "left", "right"],
              )
            : para("No DNS lookups in the capture.")) +
          (ip.servers.length ? para(`DNS servers used: ${mono(esc(ip.servers.join(", ")))}`) : ""),
      ),
    );
  }
  return out.join("");
}

// --- page frame ---------------------------------------------------------------------------------

export interface ReportMeta {
  title: string;
  chip?: string;
  meta: string;
}

function footer() {
  return `<p style="margin:16px 0 0;${FONT}font-size:12px;line-height:1.6;color:${C.muted}">Written from the log itself by Skyworth 3GPP Decoder, offline on the analyst's computer.<br>Copyright &copy; 2026 Rahul Kumbhar. Skyworth 3GPP Decoder&trade; by Rahul Kumbhar. SKYWORTH, &#21019;&#32500; and the SKYWORTH logo are trademarks of Skyworth Group.</p>`;
}

function viewBody(report: Report, tab: ReportTab, selected: number, ctx: Ctx) {
  switch (tab) {
    case "summary":
      return summaryHtml(report);
    case "flow":
      return flowHtml(report);
    case "messages":
      return messagesHtml(report, selected);
    case "radio":
      return radioHtml(report, ctx);
    case "context":
      return contextHtml(report);
    case "files":
      return filesHtml(report);
  }
}

/** The page the user is on, as email-safe HTML. Charts come back as specs to render to PNG. */
export function emailParts(report: Report, tab: ReportTab, selected: number) {
  const charts: ChartSpec[] = [];
  const ctx: Ctx = {
    file: false,
    chart: (c) => {
      charts.push(c);
      return `%%CHART:${c.id}%%`;
    },
  };
  const body = viewBody(report, tab, selected, ctx);
  const html = `<div style="background:${C.page};padding:14px 14px 0 14px;${FONT}color:${C.ink}">${table(`<tr><td>${body}</td></tr>`, "max-width:880px;")}</div>`;
  return { html, charts };
}

const LOG_TONE: Record<LogTone, Tone> = { bad: "bad", warn: "warn", ok: "ok", none: "neutral", busy: "info" };

/** The All logs page, as email-safe HTML: which folders have issues, then one card per folder. */
export function fleetEmailHtml(logs: FleetLog[]) {
  const o = fleetOverview(logs);
  const t = LOG_TONE[o.tone];
  const hero = card(
    `${chip(esc(o.kick), t)}<div style="${FONT}font-size:24px;line-height:1.3;font-weight:700;color:${C.ink};margin:8px 0 0 0">${esc(o.head)}</div>${o.detail ? para(esc(o.detail), "font-size:15px") : ""}`,
    { top: TONE[t].mark, pad: "20px 22px" },
  );
  const cards = logs.map((l, i) => {
    const v = logVerdict(l);
    const tt = LOG_TONE[v.tone];
    const facts = logFacts(l);
    const issue = v.tone === "bad" || v.tone === "warn";
    return card(
      `${table(
        `<tr><td valign="top" style="${MONO}font-size:14px;font-weight:700;color:${C.ink};word-break:break-all">${esc(l.name)}</td><td align="right" valign="top" style="padding-left:8px">${chip(esc(v.word), tt)}</td></tr>`,
      )}<div style="${FONT}font-size:12.5px;color:${C.muted};margin-top:2px">Log ${i + 1} of ${logs.length}${facts.length ? ` &#183; ${esc(facts.join(" · "))}` : ""}</div><div style="${FONT}font-size:15px;font-weight:600;color:${C.ink};margin-top:8px">${esc(v.head)}</div>${
        v.detail ? para(esc(v.detail)) : ""
      }${v.todo && issue ? box(`<b style="color:${C.okInk}">What to do:</b> ${esc(v.todo)}`, "ok") : ""}`,
      { top: TONE[tt].mark, pad: "14px 16px" },
    );
  });
  return `<div style="background:${C.page};padding:14px 14px 0 14px;${FONT}color:${C.ink}">${table(`<tr><td>${hero}${cards.join("")}</td></tr>`, "max-width:880px;")}</div>`;
}

/** Render chart specs to PNG data URLs (Outlook shows images, not SVG). */
export async function chartPngs(charts: ChartSpec[], scale = 2): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const c of charts) {
    const url = URL.createObjectURL(new Blob([c.svg], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("chart"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = c.w * scale;
      canvas.height = c.h * scale;
      const g = canvas.getContext("2d")!;
      g.scale(scale, scale);
      g.drawImage(img, 0, 0, c.w, c.h);
      out[c.id] = canvas.toDataURL("image/png");
    } catch {
      /* leave the chart out */
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return out;
}

export async function emailHtml(report: Report, tab: ReportTab, selected: number) {
  const { html, charts } = emailParts(report, tab, selected);
  const png = await chartPngs(charts);
  return html.replace(/%%CHART:([\w-]+)%%/g, (_m, id: string) => {
    const c = charts.find((x) => x.id === id)!;
    return png[id] ? `<img src="${png[id]}" width="${c.w}" height="${c.h}" alt="${esc(id)}" style="display:block;max-width:100%;height:auto;border:1px solid ${C.line};border-radius:12px">` : "";
  });
}

/** Static fallback for several logs (dev server only): the All logs page as a document. */
export function fleetFileHtml(logs: FleetLog[], meta: ReportMeta) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(meta.title)} - Skyworth 3GPP Decoder report</title></head><body style="margin:0;background:${C.page}">${fleetEmailHtml(logs)}${footer()}</body></html>`;
}

/** The whole report as one self-contained HTML file. */
export function fileHtml(report: Report, meta: ReportMeta) {
  const ctx: Ctx = { file: true, chart: (c) => `<div style="border:1px solid ${C.line};border-radius:12px;overflow:hidden">${c.svg.replace("<svg ", '<svg style="display:block;width:100%;height:auto" ')}</div>` };
  const s = report.session;
  const sections: [string, string, string][] = [];
  if (s && report.messages.length > 1) sections.push(["summary", "Summary", summaryHtml(report)]);
  if (s && report.messages.length > 1) sections.push(["flow", "Signalling flow", flowHtml(report)]);
  const msgs = report.messages
    .map((m) => {
      const r = m.result;
      const sev = worstSeverity(r);
      return `<details id="msg-${m.index + 1}" class="msg"${report.messages.length === 1 ? " open" : ""}><summary><span class="n">#${m.index + 1}</span><span class="t">${esc(m.timestamp ?? "")}</span><b>${esc(
        r.ok ? r.message?.title : "Could not decode",
      )}</b><span class="p">${esc(r.ok ? protocolShort(r) : `${r.bytes} bytes`)}</span>${sev ? chip(SEV_WORD[sev], SEV_TONE[sev]) : ""}</summary><div class="body">${messageHtml(m, report.messages.length)}</div></details>`;
    })
    .join("");
  sections.push(["messages", `Messages (${report.messages.length})`, card(head("Messages", "Select a message to open its full decode. Open all to print everything.", "&#8801;") + msgs)]);
  if (s && (s.radio.points.length || s.radio.modem?.points.length)) sections.push(["radio", "Radio", radioHtml(report, ctx)]);
  if (s) sections.push(["context", "Context", contextHtml(report)]);
  if (report.capture?.files?.length) sections.push(["files", "Files", filesHtml(report)]);
  const nav = sections.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join("");
  const logo = `<svg viewBox="0 0 1800 162" role="img" aria-label="SKYWORTH" style="height:16px;width:178px;display:block">${SKYWORTH_LOGO_SVG}</svg>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} - Skyworth 3GPP Decoder report</title>
<style>
  body{margin:0;background:${C.page};color:${C.ink};${FONT}}
  .bar{position:sticky;top:0;z-index:5;background:rgba(252,253,254,.92);backdrop-filter:blur(12px);border-bottom:1px solid ${C.line}}
  .bar .in{max-width:1100px;margin:0 auto;padding:12px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px}
  .brand i{width:1px;height:22px;background:${C.line2}}
  .id h1{margin:0;font-size:18px;font-weight:800}
  .id div{font-size:12.5px;color:${C.muted}}
  nav{display:flex;flex-wrap:wrap;gap:4px;margin-left:auto}
  nav a{color:${C.ink2};text-decoration:none;font-weight:700;font-size:13px;padding:6px 10px;border-radius:9px}
  nav a:hover{background:${C.accent};color:${C.ink}}
  main{max-width:1100px;margin:0 auto;padding:20px}
  section{scroll-margin-top:90px;margin-bottom:26px}
  section>h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};margin:0 0 10px}
  details.msg{border-top:1px solid ${C.line}}
  details.msg>summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:10px 4px;font-size:14px}
  details.msg>summary::-webkit-details-marker{display:none}
  details.msg>summary:hover{background:${C.panel2}}
  details.msg .n{font-family:Consolas,monospace;color:${C.muted};font-size:12px;min-width:34px}
  details.msg .t{font-family:Consolas,monospace;color:${C.ink2};font-size:12.5px}
  details.msg .p{color:${C.ink2};font-size:13px}
  details.msg .body{padding:6px 0 10px}
  .tools{display:flex;gap:8px;margin:0 0 14px}
  .tools button{font:inherit;font-size:13px;font-weight:700;padding:7px 12px;border-radius:10px;border:1px solid ${C.line2};background:#fff;cursor:pointer}
  @media print{.bar{position:static}.tools{display:none}details.msg{break-inside:avoid}}
</style></head>
<body>
<div class="bar"><div class="in"><div class="brand">${logo}<i></i>3GPP Decoder</div><div class="id"><h1>${esc(meta.title)}</h1><div>${esc(meta.meta)}</div></div><nav>${nav}</nav></div></div>
<main>
<div class="tools"><button type="button" onclick="document.querySelectorAll('details.msg').forEach(function(d){d.open=true})">Open every message</button><button type="button" onclick="document.querySelectorAll('details.msg').forEach(function(d){d.open=false})">Close all</button><button type="button" onclick="window.print()">Print or save as PDF</button></div>
${sections.map(([id, label, body]) => `<section id="${id}"><h2>${esc(label)}</h2>${body}</section>`).join("\n")}
${footer()}
</main>
</body></html>`;
}

/** Report data built into an exported page (see viewerHtml): one log, or several. */
export interface EmbeddedReport {
  report?: Report;
  fleet?: FleetLog[];
  meta: ReportMeta;
  exported: string;
}

export function embeddedReport(): EmbeddedReport | null {
  return (window as unknown as { __SKYWORTH_REPORT__?: EmbeddedReport }).__SKYWORTH_REPORT__ ?? null;
}

/** The report to share: the same analysis without the capture's list of files. */
export function withoutFiles(report: Report): Report {
  if (!report.capture?.files) return report;
  const capture = { ...report.capture };
  delete capture.files;
  return { ...report, capture };
}

/** Several logs to share, each without its list of files. */
export function fleetWithoutFiles(logs: FleetLog[]): FleetLog[] {
  return logs.map((l) => {
    const info = l.info ? { ...l.info } : undefined;
    if (info) delete info.files;
    return { ...l, report: l.report ? withoutFiles(l.report) : undefined, info };
  });
}

/**
 * The report as one .html file that looks and works like the app: this page's own code and
 * styles (about 1 MB, without the decoder engine) opened straight on this report. Null on the
 * dev server, where the app is loaded from many files rather than one page.
 */
export function viewerHtml(content: { report?: Report; fleet?: FleetLog[] }, meta: ReportMeta): string | null {
  const code = document.querySelector<HTMLScriptElement>('script[type="module"]')?.textContent ?? "";
  if (code.length < 10000) return null;
  const css = Array.from(document.querySelectorAll("style"))
    .map((el) => el.textContent ?? "")
    .join("\n");
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.outerHTML ?? "";
  // "<" as \u003c keeps the data from ending its <script> element early
  const data = JSON.stringify({ ...content, meta, exported: new Date().toISOString() } satisfies EmbeddedReport).replace(/</g, "\\u003c");
  return [
    "<!doctype html>",
    '<html lang="en" class="h-full antialiased">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    `<title>${esc(meta.title)} - Skyworth 3GPP Decoder report</title>`,
    icon,
    `<style>${css}</style>`,
    `<script>window.__SKYWORTH_REPORT__ = ${data};</script>`,
    `<script type="module">${code}</script>`,
    "</head>",
    '<body class="min-h-dvh"><div id="root"></div></body>',
    "</html>",
  ].join("\n");
}

/** Put HTML (and a text fallback) on the clipboard so it pastes with its formatting. */
export async function copyHtml(html: string, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
      return true;
    }
  } catch {
    /* fall through to the selection copy */
  }
  const host = document.createElement("div");
  host.setAttribute("contenteditable", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:900px;";
  host.innerHTML = html;
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  try {
    return document.execCommand("copy");
  } finally {
    sel?.removeAllRanges();
    host.remove();
  }
}
