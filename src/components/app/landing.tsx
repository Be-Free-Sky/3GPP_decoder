import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsLeftRightIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  FlowArrowIcon,
  GitForkIcon,
  GlobeHemisphereEastIcon,
  ListMagnifyingGlassIcon,
  LockSimpleIcon,
  ProhibitIcon,
  SparkleIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import samples from "@/data/samples.json";
import type { CaptureSource } from "@/lib/capture";
import { InputPanel, type InputProps } from "./input-panel";
import { UploadPane } from "./upload-pane";
import { EngineStatus } from "./engine-status";
import { SiteFooter } from "./brand";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

type SessionSample = { id: string; title: string; description: string; text: string };
type SingleSample = { id: string; title: string; group: string; hex: string };

const SESSIONS = samples.sessions as SessionSample[];
const SINGLE = samples.single as SingleSample[];
const GROUPS = Array.from(new Set(SINGLE.map((s) => s.group)));

/** What each example shows. They are built from 3GPP-encoded messages, not field captures. */
const EXAMPLES: Record<string, { icon: typeof CheckCircleIcon; outcome: string; ok: boolean; shows: string }> = {
  "lte-attach-ok": {
    icon: CheckCircleIcon,
    outcome: "Healthy",
    ok: true,
    shows: "A normal LTE attach, from RRC setup to the default bearer. What good looks like.",
  },
  "lte-ho-drop": {
    icon: ArrowsLeftRightIcon,
    outcome: "Call drop",
    ok: false,
    shows: "Coverage fades, the handover fails and re-establishment is rejected.",
  },
  "nr-sa-slice-reject": {
    icon: ProhibitIcon,
    outcome: "Registration reject",
    ok: false,
    shows: "The AMF rejects 5G registration with cause #62: no network slices available.",
  },
  "nr-sa-pdu-fail": {
    icon: GlobeHemisphereEastIcon,
    outcome: "PDU session reject",
    ok: false,
    shows: "Registration works, then the data session fails with 5GSM cause #27, unknown DNN.",
  },
  "endc-scg-fail": {
    icon: GitForkIcon,
    outcome: "SCG failure",
    ok: false,
    shows: "LTE adds an n78 NR leg and random access on it fails.",
  },
};

const FEATURES = [
  {
    icon: SparkleIcon,
    tile: "linear-gradient(135deg,#02457a,#001b48)",
    title: "A summary anyone can read",
    text: "The problem and what to do, with a status for radio, connection, registration and data.",
  },
  {
    icon: ListMagnifyingGlassIcon,
    tile: "linear-gradient(135deg,#0069c8,#02457a)",
    title: "Every message explained",
    text: "Plain words, key fields with units and the full 3GPP field tree, NAS inside RRC included.",
  },
  {
    icon: FlowArrowIcon,
    tile: "linear-gradient(135deg,#018abe,#0069c8)",
    title: "Signalling flow and radio",
    text: "A ladder between UE, eNB or gNB and the core, and RSRP, RSRQ and SINR over time.",
  },
  {
    icon: LockSimpleIcon,
    tile: "linear-gradient(135deg,#018abe,#02457a)",
    title: "Private, works offline",
    text: "The decoder lives inside this page. Nothing is uploaded, so subscriber data stays here.",
  },
];

type Pane = "paste" | "file" | "examples";

const PANES: { id: Pane; label: string; short: string; icon: typeof ClipboardTextIcon }[] = [
  { id: "paste", label: "Paste hex", short: "Paste", icon: ClipboardTextIcon },
  { id: "file", label: "Upload log", short: "Upload", icon: UploadSimpleIcon },
  { id: "examples", label: "Examples", short: "Examples", icon: BookOpenIcon },
];

export function Landing({
  input,
  onFile,
  onCapture,
  onSample,
  resume,
}: {
  input: InputProps;
  onFile: (name: string, text: string) => void;
  onCapture: (source: CaptureSource) => void;
  onSample: (title: string, text: string) => void;
  /** offered when a decode is still in memory */
  resume: { label: string; onResume: () => void } | null;
}) {
  const reduce = useReducedMotion();
  const [pane, setPane] = useState<Pane>("paste");
  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, transform: "translateY(8px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.36, delay: 0.04 + i * 0.05, ease: EASE },
        };

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto grid w-full max-w-[1100px] flex-1 grid-cols-1 content-center px-[clamp(16px,4vw,40px)] pb-6 pt-[clamp(20px,4vh,40px)] min-[1100px]:max-w-[1480px] min-[1100px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[1100px]:gap-x-[clamp(36px,4vw,72px)] min-[1100px]:px-[clamp(24px,3.4vw,48px)] min-[1100px]:pb-1 min-[1100px]:pt-[18px]">
        <motion.section
          {...enter(0)}
          className="mx-auto mb-[26px] mt-2.5 max-w-[840px] text-center min-[1100px]:col-start-1 min-[1100px]:row-start-1 min-[1100px]:m-0 min-[1100px]:max-w-none min-[1100px]:self-end min-[1100px]:text-left"
        >
          {resume ? (
            <button
              onClick={resume.onResume}
              className="press mb-3.5 inline-flex h-[38px] items-center gap-2 rounded-[11px] border border-line-2 bg-white/70 px-4 text-[13.5px] font-semibold text-foreground transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-hover-2"
            >
              <ArrowLeftIcon weight="bold" className="size-4" />
              {resume.label}
            </button>
          ) : null}
          <h1 className="mb-4 mt-2 text-[clamp(40px,7vw,76px)] font-bold leading-[1.04] tracking-[-0.045em] min-[1100px]:mb-2.5 min-[1100px]:mt-0 min-[1100px]:text-[clamp(52px,4.4vw,76px)]">
            <span className="text-foreground">Skyworth</span> <span className="text-brand-gradient">3GPP Decoder</span>
          </h1>
          <p className="mx-auto mb-2.5 text-[clamp(21px,3vw,30px)] font-bold tracking-[-0.01em] text-ink-2 min-[1100px]:mx-0 min-[1100px]:mb-2">
            Turn modem hex into answers.
          </p>
          <p className="mx-auto max-w-[720px] text-balance text-[clamp(16.5px,2.2vw,20.5px)] leading-relaxed text-ink-2 min-[1100px]:mx-0">
            Paste LTE or 5G signalling from Logel. See what went wrong and how to fix it, in plain words.
          </p>
        </motion.section>

        <motion.section
          {...enter(1)}
          aria-label="Open a log"
          className="glass mx-auto flex w-full max-w-[800px] flex-col rounded-[24px] p-2.5 min-[1100px]:col-start-2 min-[1100px]:row-span-2 min-[1100px]:row-start-1 min-[1100px]:max-w-none"
        >
          <div
            role="tablist"
            aria-label="How to open a log"
            className="mx-auto mb-2.5 mt-1.5 flex w-full max-w-full gap-1 rounded-[14px] border border-border bg-sunken p-1 min-[521px]:w-max"
          >
            {PANES.map((p) => {
              const active = pane === p.id;
              return (
                <button
                  key={p.id}
                  role="tab"
                  id={`tab-${p.id}`}
                  aria-selected={active}
                  aria-controls={`pane-${p.id}`}
                  onClick={() => setPane(p.id)}
                  className={cn(
                    "relative inline-flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-1.5 py-2 text-[13.5px] font-semibold transition-colors duration-150 min-[521px]:flex-none min-[521px]:px-4",
                    active ? "text-foreground" : "text-ink-2 hover:text-foreground",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="land-seg"
                      transition={reduce ? { duration: 0 } : { type: "spring", duration: 0.32, bounce: 0.12 }}
                      className="absolute inset-0 rounded-[10px] bg-panel shadow-[0_1px_3px_rgb(0_27_72/0.12),inset_0_0_0_1px_rgb(11_27_52/0.13)]"
                    />
                  ) : null}
                  <p.icon weight={active ? "fill" : "bold"} className="relative hidden size-4 min-[421px]:block" />
                  <span className="relative">{p.label}</span>
                </button>
              );
            })}
          </div>

          {pane === "paste" ? (
            <div id="pane-paste" role="tabpanel" aria-labelledby="tab-paste" className="flex flex-1 flex-col">
              <InputPanel {...input} />
            </div>
          ) : null}

          {pane === "file" ? (
            <div id="pane-file" role="tabpanel" aria-labelledby="tab-file" className="flex flex-1 flex-col">
              <UploadPane onText={onFile} onCapture={onCapture} busy={input.decoding} />
            </div>
          ) : null}

          {pane === "examples" ? (
            <div id="pane-examples" role="tabpanel" aria-labelledby="tab-examples" className="flex flex-1 flex-col gap-2 px-1 pb-1">
              <p className="px-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
                Short sessions, each with a different kind of problem. Built from 3GPP-encoded messages, not field captures.
              </p>
              <ul className="flex flex-col gap-1.5">
                {SESSIONS.map((s) => {
                  const m = EXAMPLES[s.id];
                  const Icon = m?.icon ?? FlowArrowIcon;
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => onSample(s.title, s.text)}
                        className="press group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-border bg-panel px-3 py-2.5 text-left transition-[border-color,box-shadow,background-color] duration-150 hover:border-accent-ring hover:bg-white hover:shadow-[0_8px_22px_-14px_rgb(2_69_122/0.5)]"
                      >
                        <span
                          className={cn(
                            "grid size-9 place-items-center rounded-[11px] text-white",
                            m?.ok ? "bg-[linear-gradient(135deg,#2fb86a,#12924a)]" : "bg-[linear-gradient(135deg,#e0485f,#c21d3a)]",
                          )}
                        >
                          <Icon weight="bold" className="size-[18px]" />
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-[14.5px] font-semibold text-foreground">{s.title}</span>
                            <span
                              className={cn(
                                "rounded-full px-2 py-px text-[11.5px] font-bold",
                                m?.ok ? "bg-ok-soft text-ok-ink" : "bg-critical-soft text-critical-ink",
                              )}
                            >
                              {m?.outcome ?? "Session"}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{m?.shows ?? s.description}</span>
                        </span>
                        <ArrowRightIcon
                          weight="bold"
                          className="size-4 text-muted-foreground transition-[transform,color] duration-150 ease-(--ease-out) group-hover:translate-x-0.5 group-hover:text-link"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <details className="group mt-1 rounded-[14px] border border-border bg-panel-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-[13.5px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  One message at a time
                  <span className="text-[12.5px] font-medium text-muted-foreground">
                    {SINGLE.length} messages <span className="group-open:hidden">· show</span>
                    <span className="hidden group-open:inline">· hide</span>
                  </span>
                </summary>
                <div className="flex flex-col gap-3 px-3.5 pb-3.5">
                  {GROUPS.map((g) => (
                    <div key={g}>
                      <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{g}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {SINGLE.filter((s) => s.group === g).map((s) => (
                          <button
                            key={s.id}
                            onClick={() => onSample(s.title, s.hex)}
                            className="press rounded-full border border-line-2 bg-panel px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-[border-color,color,background-color] duration-150 hover:border-accent-ring hover:bg-accent hover:text-foreground"
                          >
                            {s.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-center gap-2 border-t border-border px-2 pb-1 pt-2.5 text-[12.5px] text-muted-foreground">
            <EngineStatus />
          </div>
        </motion.section>

        <section aria-label="Features" className="mt-7 grid grid-cols-1 content-start gap-3 self-start min-[521px]:grid-cols-2 min-[1100px]:col-start-1 min-[1100px]:row-start-2 min-[1100px]:mt-[22px]">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              {...enter(i + 2)}
              className="grid grid-cols-[auto_minmax(0,1fr)] content-start items-start gap-x-3.5 rounded-[18px] border border-border bg-white/70 px-[18px] py-4 shadow-lift min-[1100px]:px-4 min-[1100px]:py-3.5"
            >
              <span className="row-span-2 grid size-[38px] place-items-center rounded-[11px] text-white" style={{ background: f.tile }}>
                <f.icon weight="bold" className="size-5" />
              </span>
              <h3 className="mb-1 mt-px text-[17px] font-bold tracking-[-0.01em] text-foreground">{f.title}</h3>
              <p className="text-[14.5px] leading-[1.55] text-ink-2">{f.text}</p>
            </motion.div>
          ))}
        </section>
      </main>
      <SiteFooter big className="mx-auto my-5 w-[calc(min(1100px,100%)-2*clamp(16px,4vw,40px))] min-[1100px]:my-4 min-[1100px]:w-[calc(min(1480px,100%)-2*clamp(24px,3.4vw,48px))]" />
    </div>
  );
}
