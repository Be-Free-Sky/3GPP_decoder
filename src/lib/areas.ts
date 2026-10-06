import type { Finding, Procedure, Report, Severity } from "@/lib/engine/types";

export type AreaId = "radio" | "connection" | "registration" | "data";
export type AreaStatus = "bad" | "warn" | "ok" | "none";

export interface Area {
  id: AreaId;
  title: string;
  status: AreaStatus;
  word: string;
  say: string;
  todo?: string;
  /** messages that show it */
  refs: number[];
  /** where "See the details" goes */
  target: { tab: "flow" | "messages" | "radio"; index?: number };
  /** 1 to 4 signal bars for the radio tile */
  bars?: number;
}

const PROC_AREA: Record<string, AreaId> = {
  "lte-reconf": "radio",
  "nr-reconf": "radio",
  "lte-rrc-reest": "radio",
  "nr-rrc-reest": "radio",
  "lte-rrc-setup": "connection",
  "nr-rrc-setup": "connection",
  "lte-rrc-resume": "connection",
  "nr-rrc-resume": "connection",
  "eps-attach": "registration",
  "eps-tau": "registration",
  "eps-sr": "registration",
  "eps-auth": "registration",
  "eps-smc": "registration",
  "eps-id": "registration",
  "eps-detach": "registration",
  "5gs-reg": "registration",
  "5gs-sr": "registration",
  "5gs-auth": "registration",
  "5gs-smc": "registration",
  "5gs-id": "registration",
  "5gs-dereg": "registration",
  "lte-as-sec": "registration",
  "nr-as-sec": "registration",
  "lte-cap": "registration",
  "nr-cap": "registration",
  "eps-pdn": "data",
  "eps-dedi": "data",
  "eps-esminfo": "data",
  "5gs-pdu": "data",
  "5gs-pdu-rel": "data",
};

const TITLES: Record<AreaId, string> = {
  radio: "Radio link",
  connection: "Connection",
  registration: "Registration and security",
  data: "Data session",
};

const OK_WORD: Record<AreaId, string> = { radio: "Stable", connection: "Connected", registration: "Registered", data: "Data up" };

export function areaOfFinding(f: Finding): AreaId | null {
  const ref = f.ref ?? "";
  if (/24\.(301|501) Annex B/.test(ref)) return "data";
  if (/24\.(301|501) Annex A/.test(ref)) return "registration";
  switch (f.category) {
    case "coverage":
    case "interference":
    case "radio":
    case "mobility":
    case "endc":
    case "configuration":
    case "device":
      return "radio";
    case "congestion":
    case "access":
    case "voice":
      return "connection";
    case "subscription":
    case "security":
    case "network":
      return "registration";
    case "config":
    case "data":
      return "data";
    case "procedure": {
      const t = f.title.toLowerCase();
      if (/pdn|pdu|bearer|esm/.test(t)) return "data";
      if (/re-establishment|reconfiguration|handover/.test(t)) return "radio";
      if (/rrc setup|rrc connection setup|resume/.test(t)) return "connection";
      return "registration";
    }
    default:
      return null;
  }
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

function shortName(p: Procedure) {
  return p.name.replace(/ \((LTE|NR|EPS|5GS|EPS AKA|5G AKA)\)$/, "");
}

function listJoin(xs: string[]) {
  const u = [...new Set(xs)];
  if (u.length <= 1) return u.join("");
  return `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
}

function firstSentence(s?: string) {
  if (!s) return "";
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  return m ? m[1] : s;
}

export function buildAreas(report: Report): Area[] {
  const s = report.session;
  if (!s) return [];
  const procs = s.procedures;
  const findings = s.findings.filter((f) => f.severity === "critical" || f.severity === "warning");
  const families = new Set(report.messages.map((m) => m.result.protocol?.family ?? ""));
  const hasRrc = [...families].some((f) => /RRC/.test(f));
  const out: Area[] = [];

  for (const id of ["radio", "connection", "registration", "data"] as AreaId[]) {
    const ps = procs.filter((p) => PROC_AREA[p.id] === id);
    const fs = findings.filter((f) => areaOfFinding(f) === id).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const failed = ps.filter((p) => p.status === "failure");
    const modem = s.radio.modem;
    const present = ps.length > 0 || fs.length > 0 || (id === "radio" && (s.radio.points.length > 0 || hasRrc || Boolean(modem?.points.length)));
    const area: Area = {
      id,
      title: TITLES[id],
      status: "none",
      word: "Not in this log",
      say: "",
      refs: [],
      target: { tab: "flow" },
    };
    if (id === "radio" && (s.radio.modem?.rsrp || s.radio.rsrp)) {
      const avg = s.radio.modem?.rsrp?.median ?? s.radio.rsrp!.avg;
      area.bars = avg >= -90 ? 4 : avg >= -100 ? 3 : avg >= -110 ? 2 : 1;
    }
    if (!present) {
      area.say = "Nothing about this in the log.";
      out.push(area);
      continue;
    }
    const top = fs[0];
    if (top || failed.length) {
      const bad = (top && top.severity === "critical") || failed.length > 0;
      area.status = bad ? "bad" : "warn";
      area.word = bad ? "Failed" : "Check this";
      area.say = top ? `${top.title}. ${firstSentence(top.detail)}`.trim() : `${shortName(failed[0])} failed (${failed[0].endTitle}).`;
      area.todo = top?.checks?.[0];
      area.refs = top?.refs ?? (failed[0] ? [failed[0].start] : []);
      area.target = { tab: "messages", index: area.refs[area.refs.length - 1] ?? area.refs[0] };
    } else {
      area.status = "ok";
      area.word = OK_WORD[id];
      const done = ps.filter((p) => p.status === "success").map(shortName);
      if (id === "radio") {
        area.say = modem?.rsrp
          ? `Serving RSRP ${modem.rsrp.median} dBm` +
            (modem.sinr ? `, SINR ${modem.sinr.median} dB` : "") +
            ` (medians of ${modem.rsrp.n} modem samples). No radio link failure or handover problem.`
          : s.radio.rsrp
            ? `Serving RSRP ${s.radio.rsrp.min} to ${s.radio.rsrp.max} dBm over ${s.radio.points.length} reports. No radio link failure or handover problem.`
            : "No radio link failure or handover problem.";
        area.target = s.radio.points.length || modem?.points.length ? { tab: "radio" } : { tab: "flow" };
      } else if (id === "data") {
        const ctx = s.context.data;
        const apn = ctx.find((c) => c.label === "APN / DNN")?.value;
        const ip = (ctx.find((c) => c.label === "IP address (AT)") ?? ctx.find((c) => c.label === "IP address"))?.value;
        area.say =
          (done.length ? `${listJoin(done)} completed` : "Session messages decoded") +
          (apn ? ` on ${apn}` : "") +
          (ip ? `, address ${ip}` : "") +
          ".";
      } else {
        area.say = done.length ? `${listJoin(done)} completed.` : "No failure reported.";
      }
      area.refs = ps.length ? ps[0].steps : [];
    }
    out.push(area);
  }
  return out;
}

export interface Headline {
  overall: "bad" | "warn" | "ok";
  kick: string;
  head: string;
  detail?: string;
  todo?: string;
  refs: number[];
}

export function buildHeadline(report: Report): Headline {
  const s = report.session!;
  const root = s.narrative.root;
  if (s.verdict === "failure" && root) {
    return {
      overall: "bad",
      kick: "The main problem",
      head: `${root.title}.`,
      detail: root.detail,
      todo: root.checks[0],
      refs: root.refs,
    };
  }
  const warn = s.findings.find((f) => f.severity === "warning");
  if (s.verdict === "warning" && warn) {
    return { overall: "warn", kick: "Worth a look", head: `${warn.title}.`, detail: warn.detail, todo: warn.checks?.[0], refs: warn.refs ?? [] };
  }
  const done = s.procedures.filter((p) => p.status === "success");
  return {
    overall: "ok",
    kick: "All good",
    head: "Nothing in this log needs fixing.",
    detail: done.length
      ? `All ${done.length} procedures completed: ${listJoin(done.map(shortName))}.`
      : "Every message decoded and no failure cause was reported.",
    refs: [],
  };
}
