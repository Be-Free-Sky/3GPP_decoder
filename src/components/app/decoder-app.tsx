import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChartLineIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FlowArrowIcon,
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
import { TopBar } from "./top-bar";
import { InputPanel } from "./input-panel";
import { MessageList } from "./message-list";
import { MessageView } from "./message-view";
import { OverviewView } from "./overview-view";
import { FlowView } from "./flow-view";
import { RadioView } from "./radio-view";
import { ContextView } from "./context-view";
import { Welcome } from "./welcome";
import { EngineStatus, useEngineState } from "./engine-status";
import { cn } from "@/lib/utils";

type Tab = "overview" | "flow" | "message" | "radio" | "context";

const TAB_META: Record<Tab, { label: string; icon: typeof SquaresFourIcon }> = {
  overview: { label: "Overview", icon: SquaresFourIcon },
  flow: { label: "Signalling flow", icon: FlowArrowIcon },
  message: { label: "Message", icon: ListMagnifyingGlassIcon },
  radio: { label: "Radio", icon: ChartLineIcon },
  context: { label: "Context", icon: IdentificationCardIcon },
};

const STORAGE_KEY = "skyworth-3gpp-decoder:input";

function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="h-28 rounded-2xl skeleton-line" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-16 rounded-xl skeleton-line" />
        <div className="h-16 rounded-xl skeleton-line" />
      </div>
      <div className="h-4 w-1/3 rounded skeleton-line" />
      <div className="h-48 rounded-2xl skeleton-line" />
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
  const engineState = useEngineState();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    engine.boot();
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // Restored after hydration on purpose: the static HTML has no access to localStorage.
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

  const run = useCallback(
    async (input: string, ovr: Record<number, string>, keep?: { index: number; tab: Tab }) => {
      if (!input.trim()) return;
      setDecoding(true);
      setError(null);
      try {
        const rep = await engine.decode(input, protocol, split, ovr);
        if (!rep.messages.length) {
          setReport(null);
          setError("No hex bytes were found in the input. Paste the message bytes, for example 40 12 0A ... or a Logel line ending in hex.");
          return;
        }
        setReport(rep);
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDecoding(false);
      }
    },
    [protocol, split],
  );

  const decodeInput = () => run(text, {});

  const loadSample = (sample: string) => {
    setText(sample);
    setProtocol("auto");
    setSplit("auto");
    setDecoding(true);
    setError(null);
    engine
      .decode(sample, "auto", "auto", {})
      .then((rep) => {
        setReport(rep);
        setOverrides({});
        const firstIssue = rep.messages.find((m) => worstSeverity(m.result));
        setSelected(firstIssue?.index ?? 0);
        setTab(rep.messages.length > 1 ? "overview" : "message");
        setIssuesOnly(false);
        scrollRef.current?.scrollTo({ top: 0 });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setDecoding(false));
  };

  const override = (index: number, p: string) => {
    const next = { ...overrides };
    if (p === "auto") delete next[index];
    else next[index] = p;
    run(text, next, { index, tab: "message" });
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
      if (!report || el.closest("input, textarea, [role=listbox], [contenteditable]")) return;
      if (e.key === "j" || e.key === "k") {
        const next = Math.max(0, Math.min(report.messages.length - 1, selected + (e.key === "j" ? 1 : -1)));
        setSelected(next);
        setTab("message");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [report, selected]);

  const entry = report?.messages[selected];
  const issueCount = report?.session ? report.session.kpis.critical + report.session.kpis.warnings : 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar onSample={loadSample} />
      <main className="mx-auto grid w-full max-w-[1680px] flex-1 grid-cols-1 gap-4 px-4 py-4 lg:h-[calc(100dvh-57px)] lg:grid-cols-[minmax(340px,400px)_minmax(0,1fr)] lg:overflow-hidden">
        <aside className="glass flex min-h-0 flex-col overflow-hidden rounded-2xl">
          <InputPanel
            text={text}
            setText={setText}
            protocol={protocol}
            setProtocol={setProtocol}
            split={split}
            setSplit={setSplit}
            onDecode={decodeInput}
            decoding={decoding}
            engineReady={engineState.stage === "ready"}
            compact={Boolean(report && report.messages.length > 1)}
          />
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

        <section aria-label="Results" className="glass flex min-h-[60vh] min-w-0 flex-col overflow-hidden rounded-2xl">
          {report ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 pt-2">
              <div role="tablist" aria-label="Result views" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto scrollbar-thin">
                {tabs.map((t) => {
                  const M = TAB_META[t];
                  return (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "relative -mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium transition-colors duration-150",
                        tab === t ? "border-brand-3 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <M.icon className="size-4" />
                      {M.label}
                      {t === "overview" && issueCount ? (
                        <span className="rounded-full bg-critical/10 px-1.5 text-[11px] tabular-nums text-critical">{issueCount}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-1 pb-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={async () => (await copyText(reportToMarkdown(report))) && toast.success("Report copied as Markdown")}
                >
                  <CopyIcon /> Copy report
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => downloadFile("3gpp-decode.json", JSON.stringify(report, null, 2))}
                >
                  <DownloadSimpleIcon /> JSON
                </Button>
              </div>
            </div>
          ) : null}
          <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6", decoding && report && "opacity-60 transition-opacity duration-150")}>
            {error ? (
              <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-critical/25 bg-critical/[0.05] p-4">
                <WarningCircleIcon weight="fill" className="mt-0.5 size-5 shrink-0 text-critical" />
                <div>
                  <p className="text-[14px] font-medium text-foreground">Decoding stopped</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{error}</p>
                </div>
              </div>
            ) : null}
            {decoding && !report ? <ResultSkeleton /> : null}
            {!report && !decoding ? <Welcome onSample={loadSample} /> : null}
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
