import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  ArrowsLeftRightIcon,
  ArrowUUpLeftIcon,
  ChartLineIcon,
  CheckCircleIcon,
  FlowArrowIcon,
  GitForkIcon,
  GlobeHemisphereEastIcon,
  IdentificationCardIcon,
  ListMagnifyingGlassIcon,
  LockSimpleIcon,
  ProhibitIcon,
  SquaresFourIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import samples from "@/data/samples.json";
import type { SplitMode } from "@/lib/engine/types";
import { InputPanel } from "./input-panel";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

type SessionSample = { id: string; title: string; description: string; text: string };

/** What each example teaches. They are built from 3GPP-encoded messages, not field captures. */
const EXAMPLES: Record<string, { icon: typeof CheckCircleIcon; outcome: string; ok: boolean; shows: string }> = {
  "lte-attach-ok": {
    icon: CheckCircleIcon,
    outcome: "Healthy",
    ok: true,
    shows: "A normal LTE attach from RRC setup to the default bearer, with every procedure timed. Use it as the reference for what good looks like.",
  },
  "lte-ho-drop": {
    icon: ArrowsLeftRightIcon,
    outcome: "Call drop",
    ok: false,
    shows: "Coverage fades, the handover fails and re-establishment is rejected. Shows how a radio problem is traced to its root cause.",
  },
  "nr-sa-slice-reject": {
    icon: ProhibitIcon,
    outcome: "Registration reject",
    ok: false,
    shows: "The AMF rejects 5G registration with cause #62. Shows cause-code analysis with likely causes and what to check.",
  },
  "nr-sa-pdu-fail": {
    icon: GlobeHemisphereEastIcon,
    outcome: "PDU session reject",
    ok: false,
    shows: "Registration works, then the data session fails with 5GSM cause #27, found inside a NAS transport message.",
  },
  "endc-scg-fail": {
    icon: GitForkIcon,
    outcome: "SCG failure",
    ok: false,
    shows: "LTE adds an n78 NR leg and the UE fails random access on it. Shows EN-DC containers decoded inside LTE RRC.",
  },
};

const VIEWS = [
  { icon: SquaresFourIcon, title: "Overview", text: "Verdict, root cause, likely causes and the checks to run next." },
  { icon: FlowArrowIcon, title: "Signalling flow", text: "Ladder of every message between UE, eNB / gNB and MME / AMF." },
  { icon: ListMagnifyingGlassIcon, title: "Message", text: "Plain-English summary, key fields with units, and the full field tree." },
  { icon: ChartLineIcon, title: "Radio", text: "Serving RSRP, RSRQ and SINR across the measurement reports." },
  { icon: IdentificationCardIcon, title: "Context", text: "PLMN, TAC, cell IDs, IMSI / GUTI, APN / DNN and IP in one place." },
];

const COVERAGE = [
  "LTE RRC",
  "NR RRC",
  "EPS NAS (EMM, ESM)",
  "5GS NAS (5GMM, 5GSM)",
  "NB-IoT RRC",
  "WCDMA RRC",
  "2G / 3G NAS",
  "S1AP",
  "NGAP",
  "X2AP",
  "XnAP",
  "F1AP",
  "LPP",
];

const FORMAT_EXAMPLE = `14:02:17.442  LTE RRC DL_DCCH RRCConnectionReconfiguration
20 1A 08 0C A8 ...
0000: 07 41 72 08 09 10 10 10 32 54 76 98
7E 00 44 3E`;

function messageCount(text: string) {
  return (text.match(/^\d{1,2}:\d{2}:\d{2}/gm) || []).length;
}

export function Home({
  input,
  onSample,
  resume,
}: {
  input: {
    text: string;
    setText: (t: string) => void;
    protocol: string;
    setProtocol: (p: string) => void;
    split: SplitMode;
    setSplit: (s: SplitMode) => void;
    onDecode: () => void;
    decoding: boolean;
    engineReady: boolean;
  };
  onSample: (text: string) => void;
  /** offered when a decode is still in memory */
  resume: { label: string; onResume: () => void } | null;
}) {
  const reduce = useReducedMotion();
  const sessions = samples.sessions as SessionSample[];
  const [featured, ...rest] = sessions;
  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, transform: "translateY(10px)" },
          whileInView: { opacity: 1, transform: "translateY(0px)" },
          viewport: { once: true, amount: 0.25 },
          transition: { duration: 0.32, delay: i * 0.05, ease: EASE },
        };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-16 px-4 pb-16 pt-6 sm:px-6 lg:gap-20 lg:pt-8">
      {/* Hero: what it is, and the input itself */}
      <section className="hero-mesh relative overflow-hidden rounded-[28px] p-6 text-white shadow-[0_40px_80px_-40px_rgb(0_27_72/0.75)] sm:p-8 lg:p-12">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
          <motion.div
            initial={reduce ? false : { opacity: 0, transform: "translateY(8px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex flex-col gap-6"
          >
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[12.5px] font-medium text-white/90">
              <LockSimpleIcon weight="bold" className="size-3.5" />
              Runs offline inside this page
            </span>
            <h1 className="text-balance text-[2.4rem] font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.1rem]">
              Decode Logel hex into{" "}
              <span className="underline decoration-brand-3 decoration-[6px] underline-offset-[10px]">readable signalling</span>
            </h1>
            <p className="max-w-[46ch] text-[17px] leading-relaxed text-white/80">
              Paste LTE or 5G messages and get plain-English summaries, a signalling ladder and root cause analysis.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="#examples"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById("examples")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
                }}
                className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-semibold text-brand-1 shadow-[0_10px_24px_-12px_rgb(0_0_0/0.5)] transition-colors duration-150 hover:bg-white/90"
              >
                See an example
                <ArrowRightIcon weight="bold" className="size-4" />
              </a>
              {resume ? (
                <button
                  onClick={resume.onResume}
                  className="press inline-flex h-11 items-center gap-2 rounded-full border border-white/30 px-5 text-[14.5px] font-medium text-white transition-colors duration-150 hover:bg-white/10"
                >
                  <ArrowUUpLeftIcon weight="bold" className="size-4" />
                  {resume.label}
                </button>
              ) : null}
            </div>
          </motion.div>
          <motion.div
            initial={reduce ? false : { opacity: 0, transform: "translateY(12px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            transition={{ duration: 0.45, delay: 0.06, ease: EASE }}
            className="rounded-2xl bg-white text-foreground shadow-[0_30px_60px_-30px_rgb(0_0_0/0.55)] ring-1 ring-white/40"
          >
            <InputPanel {...input} variant="hero" />
          </motion.div>
        </div>
      </section>

      {/* Examples: what each one demonstrates */}
      <section id="examples" className="scroll-mt-20">
        <div className="max-w-[62ch]">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-[2.1rem]">
            Example <span className="text-brand-gradient">sessions</span>
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-muted-foreground">
            Five short logs, each showing a different kind of problem. Open one to see how the decoder finds the failure, explains it and draws the
            call flow, before you paste your own. They are built from 3GPP-encoded messages, not field captures.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featured ? (
            <motion.button
              {...enter(0)}
              onClick={() => onSample(featured.text)}
              className="lift brand-gradient group relative flex min-h-64 flex-col justify-between overflow-hidden rounded-3xl p-7 text-left text-white md:col-span-2 lg:col-span-1 lg:row-span-2"
            >
              <div>
                <span className="grid size-12 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                  <CheckCircleIcon weight="fill" className="size-6 text-white" />
                </span>
                <span className="mt-6 inline-flex rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-semibold">Healthy reference</span>
                <h3 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight">{featured.title}</h3>
                <p className="mt-3 max-w-[38ch] text-[15px] leading-relaxed text-white/80">{EXAMPLES[featured.id]?.shows ?? featured.description}</p>
                <ul className="mt-6 flex flex-wrap gap-2" aria-label="Procedures in this session">
                  {["RRC setup", "Authentication", "NAS security", "AS security", "UE capability", "Reconfiguration", "Default bearer", "Attach"].map(
                    (p) => (
                      <li key={p} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[12.5px] font-medium text-white/90 ring-1 ring-white/15">
                        <CheckCircleIcon weight="fill" className="size-3.5 text-white" />
                        {p}
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <div className="mt-8 flex items-end justify-between gap-4">
                <dl className="flex gap-8">
                  <div>
                    <dt className="text-[12px] text-white/65">Messages</dt>
                    <dd className="text-2xl font-semibold">{messageCount(featured.text)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-white/65">Procedures</dt>
                    <dd className="text-2xl font-semibold">8</dd>
                  </div>
                </dl>
                <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold">
                  Open
                  <ArrowRightIcon weight="bold" className="size-4 transition-transform duration-150 ease-(--ease-out) group-hover:translate-x-0.5" />
                </span>
              </div>
            </motion.button>
          ) : null}
          {rest.map((s, i) => {
            const meta = EXAMPLES[s.id];
            const Icon = meta?.icon ?? XCircleIcon;
            return (
              <motion.button
                key={s.id}
                {...enter(i + 1)}
                onClick={() => onSample(s.text)}
                className="lift group flex flex-col rounded-3xl border border-border bg-white p-6 text-left hover:border-brand-3/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="brand-gradient grid size-11 place-items-center rounded-2xl shadow-[0_8px_18px_-10px_rgb(2_69_122/0.8)]">
                    <Icon weight="bold" className="size-5 text-white" />
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[12px] font-semibold",
                      meta?.ok ? "bg-brand-3/10 text-brand-2" : "bg-critical/10 text-critical",
                    )}
                  >
                    {meta?.outcome ?? "Session"}
                  </span>
                </div>
                <h3 className="mt-5 text-[18px] font-semibold leading-snug tracking-tight text-foreground">{s.title}</h3>
                <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted-foreground">{meta?.shows ?? s.description}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-brand-2">
                  Open example
                  <ArrowRightIcon weight="bold" className="size-4 transition-transform duration-150 ease-(--ease-out) group-hover:translate-x-0.5" />
                </span>
              </motion.button>
            );
          })}
        </div>
      </section>

      {/* The five views */}
      <section>
        <h2 className="max-w-[24ch] text-3xl font-semibold tracking-tight text-foreground sm:text-[2.1rem]">What you get after decoding</h2>
        <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
          {VIEWS.map((v, i) => (
            <motion.div key={v.title} {...enter(i)} className="flex flex-col gap-3">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand-3/10 text-brand-2 ring-1 ring-brand-3/20">
                <v.icon weight="duotone" className="size-6" />
              </span>
              <h3 className="text-[17px] font-semibold text-foreground">{v.title}</h3>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{v.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Input formats and coverage */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="rounded-3xl bg-brand-1 p-7 text-white">
          <h2 className="text-[20px] font-semibold">Paste it the way Logel shows it</h2>
          <p className="mt-2 max-w-[60ch] text-[14.5px] leading-relaxed text-white/75">
            Raw hex, hexdumps with offsets, 0x lists, or lines with a timestamp and channel. Headers name the channel; without them every channel is
            tried and only a decode that re-encodes to the same bytes is kept.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-2xl bg-white/[0.07] p-4 font-mono text-[12.5px] leading-relaxed text-white/90 ring-1 ring-white/10 scrollbar-thin">
            {FORMAT_EXAMPLE}
          </pre>
        </div>
        <div className="rounded-3xl border border-border bg-white p-7">
          <h2 className="text-[20px] font-semibold text-foreground">Protocols it understands</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
            Every channel of each family, with NAS, UE capabilities and NR cell groups decoded inside their containers.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {COVERAGE.map((c) => (
              <span key={c} className="rounded-full border border-brand-3/25 bg-brand-3/[0.07] px-3 py-1.5 text-[13px] font-medium text-brand-2">
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-3 border-t border-border pt-6 text-[13px] leading-relaxed text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <p className="flex max-w-[60ch] items-start gap-2">
          <LockSimpleIcon className="mt-0.5 size-4 shrink-0 text-brand-3" />
          Everything runs inside this one page. It makes no network requests, so operator and subscriber data stays on this machine.
        </p>
        <p className="max-w-[52ch] sm:text-right">
          Copyright © 2026 Rahul Kumbhar. SKYWORTH and 创维 are trademarks of Skyworth Group. Decodes with pycrate (LGPL 2.1) on Pyodide (MPL 2.0).
        </p>
      </footer>
    </div>
  );
}
