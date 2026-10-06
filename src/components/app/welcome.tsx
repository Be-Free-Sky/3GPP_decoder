"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRightIcon, LockSimpleIcon } from "@phosphor-icons/react";
import samples from "@/data/samples.json";

const OUTCOME: Record<string, string> = {
  "lte-attach-ok": "Healthy",
  "lte-ho-drop": "Call drop",
  "nr-sa-slice-reject": "Registration reject",
  "nr-sa-pdu-fail": "PDU session reject",
  "endc-scg-fail": "SCG failure",
};

const COVERAGE = [
  "LTE RRC, all channels",
  "NR RRC, all channels",
  "EPS NAS (EMM, ESM)",
  "5GS NAS (5GMM, 5GSM)",
  "NB-IoT RRC",
  "WCDMA RRC",
  "2G / 3G NAS",
  "S1AP, NGAP",
  "X2AP, XnAP, F1AP",
  "LPP",
];

const FORMAT_EXAMPLE = `14:02:17.442  LTE RRC DL_DCCH RRCConnectionReconfiguration
20 1A 08 0C A8 ...
0000: 07 41 72 08 09 10 10 10 32 54 76 98
7E 00 44 3E`;

export function Welcome({ onSample }: { onSample: (text: string) => void }) {
  const reduce = useReducedMotion();
  const sessions = samples.sessions as { id: string; title: string; description: string; text: string }[];
  return (
    <div className="grid grid-cols-1 gap-8 p-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="max-w-[18ch] text-3xl font-semibold leading-[1.1] tracking-tight text-foreground md:text-4xl">
            Decode Logel hex into readable signalling
          </h1>
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
            Paste LTE or 5G messages and get plain-English summaries, a signalling ladder and root cause analysis.
          </p>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-semibold text-foreground">Try a captured session</div>
          <ul className="flex flex-col gap-1.5">
            {sessions.map((s, i) => (
              <motion.li
                key={s.id}
                initial={reduce ? false : { opacity: 0, transform: "translateY(6px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ duration: 0.24, delay: 0.04 * i, ease: [0.23, 1, 0.32, 1] }}
              >
                <button
                  onClick={() => onSample(s.text)}
                  className="press group flex w-full items-center gap-3 rounded-xl border border-border bg-raised px-3.5 py-3 text-left transition-[border-color,box-shadow] duration-150 hover:border-brand-3/35 hover:shadow-[0_10px_24px_-18px_rgb(2_69_122/0.6)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium text-foreground">{s.title}</span>
                      <span className="rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">{OUTCOME[s.id] ?? "Session"}</span>
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{s.description}</span>
                  </span>
                  <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-(--ease-out) group-hover:translate-x-0.5 group-hover:text-brand-2" />
                </button>
              </motion.li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="relative overflow-hidden rounded-2xl p-5 text-white brand-gradient shadow-[0_24px_48px_-28px_rgb(0_27_72/0.8)]">
          <div className="text-[13px] font-semibold">Accepted input</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-white/75">
            Raw hex, hexdumps with offsets, 0x lists, or Logel lines with timestamp and channel. Headers name the channel; without them the decoder
            tests every channel and keeps the one that re-encodes to the same bytes.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-black/20 p-3 font-mono text-[11.5px] leading-relaxed text-white/90 scrollbar-thin">
            {FORMAT_EXAMPLE}
          </pre>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-semibold text-foreground">Protocols</div>
          <div className="flex flex-wrap gap-1.5">
            {COVERAGE.map((c) => (
              <span key={c} className="rounded-full border border-border bg-raised px-2.5 py-1 text-[12px] text-muted-foreground">
                {c}
              </span>
            ))}
          </div>
        </div>
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
          <LockSimpleIcon className="mt-0.5 size-4 shrink-0 text-brand-3" />
          Decoding runs in your browser. Pasted logs are never uploaded, so operator and subscriber data stays on this machine.
        </p>
      </div>
    </div>
  );
}
