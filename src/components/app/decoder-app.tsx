import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChartLineIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FlowArrowIcon,
  HouseIcon,
  IdentificationCardIcon,
  ListMagnifyingGlassIcon,
  SquaresFourIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { engine } from "@/lib/engine/client";
import type { Report, SplitMode } from "@/lib/engine/types";
import { copyText, downloadFile, worstSeverity } from "@/lib/format";
import { reportToMarkdown } from "@/lib/report-md";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TopBar } from "./top-bar";
import { InputPanel } from "./input-panel";
import { MessageList } from "./message-list";
import { MessageView } from "./message-view";
import { OverviewView } from "./overview-view";
import { FlowView } from "./flow-view";
import { RadioView } from "./radio-view";
import { ContextView } from "./context-view";
import { Home } from "./home";
import { EngineStatus, useEngineState } from "./engine-status";
import { cn } from "@/lib/utils";

type Tab = "overview" | "flow" | "message" | "radio" | "context";
type View = "home" | "results";

const TAB_META: Record<Tab, { label: string; short?: string; icon: typeof SquaresFourIcon }> = {
  overview: { label: "Overview", icon: SquaresFourIcon },
  flow: { label: "Signalling flow", short: "Flow", icon: FlowArrowIcon },
  message: { label: "Message", icon: ListMagnifyingGlassIcon },
  radio: { label: "Radio", icon: ChartLineIcon },
  context: { label: "Context", icon: IdentificationCardIcon },
};

const STORAGE_KEY = "skyworth-3gpp-decoder:input";
const RESULTS_HASH = "#results";

function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-32 rounded-3xl skeleton-line" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-20 rounded-2xl skeleton-line" />
        <div className="h-20 rounded-2xl skeleton-line" />
      </div>
      <div className="h-4 w-1/3 rounded skeleton-line" />
      <div className="h-56 rounded-3xl skeleton-line" />
    </div>
  );
}

export function DecoderApp() {
  const [text, setText] = useState("");
  const [protocol, setProtocol] = useState("auto");
  const [split, setSplit] = useState<SplitMode>("auto");
  const [report, setReport] = useState<Report | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [view, setView] = useState<View>("home");
  const engineState = useEngineState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasResults = useRef(false);

  useEffect(() => {
    engine.boot();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // Restored after the first render on purpose: the page HTML carries no saved state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setText(saved);
    } catch {
      /* storage blocked: start empty */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, text);
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [text]);

  // Browser Back from the results returns to the home page.
  useEffect(() => {
    const onPop = () => setView(location.hash === RESULTS_HASH && hasResults.current ? "results" : "home");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const showResults = useCallback(() => {
    if (location.hash !== RESULTS_HASH) history.pushState({ view: "results" }, "", RESULTS_HASH);
    setView("results");
    window.scrollTo({ top: 0 });
  }, []);

  const goHome = useCallback(() => {
    if (location.hash === RESULTS_HASH) history.back();
    else setView("home");
    window.scrollTo({ top: 0 });
  }, []);

  const applyReport = useCallback((rep: Report, ovr: Record<number, string>, keep?: { index: number; tab: Tab }) => {
    if (!rep.messages.length) {
      setReport(null);
      setError("No hex bytes were found in the input. Paste the message bytes, for example 40 12 0A ... or a Logel line ending in hex.");
      return;
    }
    setReport(rep);
    hasResults.current = true;
    setOverrides(ovr);
    if (keep) {
      setSelected(keep.index);
      setTab(keep.tab);
    } else {
      const firstIssue = rep.messages.find((m) => worstSeverity(m.result));
      setSelected(firstIssue?.index ?? 0);
      setTab(rep.messages.length > 1 ? "overview" : "message");
      setIssuesOnly(false);
    }
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const run = useCallback(
    async (input: string, ovr: Record<number, string>, opts?: { keep?: { index: number; tab: Tab }; protocol?: string; split?: SplitMode }) => {
      if (!input.trim()) return;
      setDecoding(true);
      setError(null);
      showResults();
      try {
        const rep = await engine.decode(input, opts?.protocol ?? protocol, opts?.split ?? split, ovr);
        applyReport(rep, ovr, opts?.keep);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDecoding(false);
      }
    },
    [protocol, split, showResults, applyReport],
  );

  const decodeInput = () => run(text, {});

  const loadSample = (sample: string) => {
    setText(sample);
    setProtocol("auto");
    setSplit("auto");
    setReport(null);
    run(sample, {}, { protocol: "auto", split: "auto" });
  };

  const override = (index: number, p: string) => {
    const next = { ...overrides };
    if (p === "auto") delete next[index];
    else next[index] = p;
    run(text, next, { keep: { index, tab: "message" } });
  };

  const openMessage = (i: number) => {
    setSelected(i);
    setTab("message");
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const tabs = useMemo<Tab[]>(() => {
    if (!report) return [];
    if (report.messages.length <= 1) return ["message", "context"];
    const t: Tab[] = ["overview", "flow", "message"];
    if (report.session?.radio.points.length) t.push("radio");
    t.push("context");
    return t;
  }, [report]);

  // j / k step through messages when the focus is not in a text field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (view !== "results" || !report || el.closest("input, textarea, [role=listbox], [contenteditable]")) return;
      if (e.key === "j" || e.key === "k") {
        const next = Math.max(0, Math.min(report.messages.length - 1, selected + (e.key === "j" ? 1 : -1)));
        setSelected(next);
        setTab("message");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [report, selected, view]);

  const entry = report?.messages[selected];
  const issueCount = report?.session ? report.session.kpis.critical + report.session.kpis.warnings : 0;
  const inputProps = {
    text,
    setText,
    protocol,
    setProtocol,
    split,
    setSplit,
    onDecode: decodeInput,
    decoding,
    engineReady: engineState.stage === "ready",
  };

  if (view === "home") {
    return (
      <div className="flex min-h-dvh flex-col">
        <TopBar onSample={loadSample} onHome={goHome} />
        <Home
          input={inputProps}
          onSample={loadSample}
          resume={
            report
              ? {
                  label: `Back to results (${report.messages.length} ${report.messages.length === 1 ? "message" : "messages"})`,
                  onResume: showResults,
                }
              : null
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar onSample={loadSample} onHome={goHome} />
      <main className="mx-auto grid w-full max-w-[1680px] flex-1 grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:h-[calc(100dvh-57px)] lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-[0_24px_48px_-32px_rgb(0_27_72/0.45)]">
          <InputPanel {...inputProps} compact={Boolean(report && report.messages.length > 1)} />
          {engineState.stage !== "ready" ? (
            <div className="px-4 pb-3 md:hidden">
              <EngineStatus />
            </div>
          ) : null}
          {report && report.messages.length > 1 ? (
            <div className="flex max-h-[50vh] min-h-0 flex-1 flex-col lg:max-h-none">
              <MessageList
                messages={report.messages}
                selected={selected}
                onSelect={openMessage}
                issuesOnly={issuesOnly}
                setIssuesOnly={setIssuesOnly}
              />
            </div>
          ) : null}
        </aside>

        <section
          aria-label="Results"
          className="flex min-h-[60vh] min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-white shadow-[0_24px_48px_-32px_rgb(0_27_72/0.45)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-gradient-to-r from-brand-3/[0.06] via-white to-white px-3 py-2.5">
            <Button variant="outline" size="lg" className="gap-1.5 rounded-full bg-white px-3.5 font-semibold text-brand-2" onClick={goHome}>
              <HouseIcon weight="bold" className="size-4" />
              Home
            </Button>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <div role="tablist" aria-label="Result views" className="flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-thin">
              {tabs.map((t) => {
                const M = TAB_META[t];
                const active = tab === t;
                return (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t)}
                    className={cn(
                      "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold transition-[background-color,color,box-shadow] duration-150",
                      active
                        ? "brand-gradient text-white shadow-[0_8px_18px_-10px_rgb(1_138_190/0.9)]"
                        : "text-muted-foreground hover:bg-brand-3/[0.08] hover:text-brand-2",
                    )}
                  >
                    <M.icon weight={active ? "fill" : "regular"} className="size-4" />
                    {M.short ? (
                      <>
                        <span className="hidden xl:inline">{M.label}</span>
                        <span className="xl:hidden">{M.short}</span>
                      </>
                    ) : (
                      M.label
                    )}
                    {t === "overview" && issueCount ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[11px] tabular-nums",
                          active ? "bg-white/25 text-white" : "bg-critical/10 text-critical",
                        )}
                      >
                        {issueCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {report ? (
              <div className="flex gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="rounded-full text-muted-foreground hover:bg-brand-3/[0.08] hover:text-brand-2"
                        aria-label="Copy report as Markdown"
                        onClick={async () => (await copyText(reportToMarkdown(report))) && toast.success("Report copied as Markdown")}
                      />
                    }
                  >
                    <CopyIcon className="size-[18px]" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Copy report (Markdown, for tickets)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="rounded-full text-muted-foreground hover:bg-brand-3/[0.08] hover:text-brand-2"
                        aria-label="Save the full decode as JSON"
                        onClick={() => downloadFile("3gpp-decode.json", JSON.stringify(report, null, 2))}
                      />
                    }
                  >
                    <DownloadSimpleIcon className="size-[18px]" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Save the full decode as JSON</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
          </div>
          <div
            ref={scrollRef}
            className={cn("min-h-0 flex-1 overflow-y-auto scrollbar-thin p-5 md:p-7", decoding && report && "opacity-60 transition-opacity duration-150")}
          >
            {error ? (
              <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-critical/25 bg-critical/[0.05] p-4">
                <WarningCircleIcon weight="fill" className="mt-0.5 size-5 shrink-0 text-critical" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-foreground">Decoding stopped</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{error}</p>
                </div>
                {!report ? (
                  <Button variant="outline" size="sm" className="shrink-0 rounded-full" onClick={goHome}>
                    <HouseIcon /> Home
                  </Button>
                ) : null}
              </div>
            ) : null}
            {decoding && !report ? <ResultSkeleton /> : null}
            {report && entry ? (
              <>
                {tab === "overview" && report.session ? <OverviewView report={report} onOpen={openMessage} /> : null}
                {tab === "flow" && report.session ? <FlowView session={report.session} selected={selected} onOpen={openMessage} /> : null}
                {tab === "message" ? (
                  <MessageView
                    entry={entry}
                    total={report.messages.length}
                    onPrev={() => setSelected((s) => Math.max(0, s - 1))}
                    onNext={() => setSelected((s) => Math.min(report.messages.length - 1, s + 1))}
                    onOverride={override}
                    onOpen={openMessage}
                  />
                ) : null}
                {tab === "radio" && report.session ? <RadioView session={report.session} onOpen={openMessage} /> : null}
                {tab === "context" && report.session ? <ContextView session={report.session} onOpen={openMessage} /> : null}
              </>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
