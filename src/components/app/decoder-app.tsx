import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChartLineIcon,
  CircleNotchIcon,
  FilesIcon,
  FlowArrowIcon,
  HouseIcon,
  IdentificationCardIcon,
  ListMagnifyingGlassIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { engine } from "@/lib/engine/client";
import type { CaptureInfo, Report, SplitMode } from "@/lib/engine/types";
import { prepareCapture, type CaptureSource } from "@/lib/capture";
import { copyText, downloadFile, fmtMs, protocolShort, worstSeverity } from "@/lib/format";
import { reportToMarkdown } from "@/lib/report-md";
import { AppBar, type TabDef } from "./app-bar";
import { Landing } from "./landing";
import { MessageList } from "./message-list";
import { MessageView } from "./message-view";
import { SummaryView } from "./summary-view";
import { FlowView } from "./flow-view";
import { RadioView } from "./radio-view";
import { ContextView } from "./context-view";
import { FilesView } from "./files-view";
import { SiteFooter } from "./brand";
import { useEngineState } from "./engine-status";
import { cn } from "@/lib/utils";

type Tab = "summary" | "flow" | "messages" | "radio" | "context" | "files";
type View = "home" | "results";
type Source = { title: string; chip?: string };

const RESULTS_HASH = "#results";

function ResultSkeleton({ phase }: { phase?: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {phase ? (
        <div role="status" className="surface flex items-center gap-3 rounded-2xl px-[18px] py-3.5 text-[14.5px] font-semibold text-foreground">
          <CircleNotchIcon weight="bold" className="size-5 animate-spin text-blue motion-reduce:animate-none" />
          {phase}
        </div>
      ) : null}
      <div aria-hidden className="h-44 rounded-[22px] skeleton-line" />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 rounded-[18px] skeleton-line" />
        ))}
      </div>
      <div className="h-64 rounded-2xl skeleton-line" />
    </div>
  );
}

export function DecoderApp() {
  // The home page box starts empty every time; examples and files never fill it.
  const [draft, setDraft] = useState("");
  const [protocol, setProtocol] = useState("auto");
  const [split, setSplit] = useState<SplitMode>("auto");
  const [report, setReport] = useState<Report | null>(null);
  const [source, setSource] = useState<Source>({ title: "Pasted log" });
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<Tab>("summary");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [view, setView] = useState<View>("home");
  const [phase, setPhase] = useState<string | null>(null);
  const [failedCapture, setFailedCapture] = useState<CaptureInfo | null>(null);
  const engineState = useEngineState();
  const hasResults = useRef(false);
  const runId = useRef(0);

  useEffect(() => {
    engine.boot();
  }, []);

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

  const begin = useCallback(
    (src: Source) => {
      const id = ++runId.current;
      setDecoding(true);
      setError(null);
      setReport(null);
      setFailedCapture(null);
      setPhase(null);
      setSource(src);
      showResults();
      return id;
    },
    [showResults],
  );

  const finish = useCallback((rep: Report) => {
    setReport(rep);
    hasResults.current = true;
    const firstIssue = rep.messages.find((m) => worstSeverity(m.result));
    setSelected(firstIssue?.index ?? 0);
    setTab(rep.messages.length > 1 && rep.session ? "summary" : "messages");
    setIssuesOnly(false);
  }, []);

  const run = useCallback(
    async (input: string, src: Source, opts?: { protocol?: string; split?: SplitMode }) => {
      if (!input.trim()) return;
      const id = begin(src);
      try {
        const rep = await engine.decode(input, opts?.protocol ?? protocol, opts?.split ?? split, {});
        if (id !== runId.current) return;
        if (!rep.messages.length) {
          setError("No hex bytes were found. Paste the message bytes, for example 40 12 0A ..., or a Logel line that ends in hex.");
          return;
        }
        finish(rep);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) setDecoding(false);
      }
    },
    [protocol, split, begin, finish],
  );

  /** A Logel capture: zip, folder or loose files. Pick the useful files, read them, decode. */
  const runCapture = useCallback(
    async (cap: CaptureSource) => {
      const id = begin({ title: cap.name, chip: cap.kind === "zip" ? "Zip" : cap.kind === "folder" ? "Folder" : "Logel log" });
      try {
        setPhase(cap.kind === "zip" ? `Opening ${cap.name}.zip` : `Opening ${cap.name}`);
        const prepared = await prepareCapture(cap, (t) => id === runId.current && setPhase(t));
        if (id !== runId.current) return;
        const info: CaptureInfo = {
          name: prepared.capture.name,
          kind: prepared.capture.kind,
          files: prepared.capture.files,
          device: prepared.capture.device,
          ip: prepared.capture.ip,
          stats: prepared.capture.stats,
          span: prepared.capture.span,
          notes: prepared.capture.notes,
        };
        let rep: Report;
        if (prepared.capture.records.length) {
          setPhase(`Decoding ${prepared.capture.records.length} RRC and NAS messages`);
          rep = await engine.decodeCapture(prepared.capture);
        } else if (prepared.text) {
          setPhase("Decoding the text export");
          rep = await engine.decode(prepared.text, "auto", "auto", {});
          rep.capture = info;
        } else {
          setFailedCapture(info);
          const logel = prepared.capture.files.find((f) => /\.logel$/i.test(f.name));
          setError(
            logel
              ? `${logel.name} holds no RRC or NAS messages this decoder reads. The files that were found are listed below.`
              : "No modem log in this selection. Logel saves it as a .logel file inside the armlog folder; open that folder, its zip, or the .logel itself.",
          );
          return;
        }
        if (id !== runId.current) return;
        if (!rep.messages.length) {
          setFailedCapture(info);
          setError("No RRC or NAS messages were found in this log.");
          return;
        }
        finish(rep);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) {
          setDecoding(false);
          setPhase(null);
        }
      }
    },
    [begin, finish],
  );

  const openMessage = useCallback((i: number) => {
    setSelected(i);
    setTab("messages");
    // On a phone the list sits above the message: bring the message itself into view.
    requestAnimationFrame(() => {
      const el = document.getElementById("message-view");
      if (el && window.innerWidth < 1024) el.scrollIntoView({ block: "start" });
      else window.scrollTo({ top: 0 });
    });
  }, []);

  const pickTab = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const multi = Boolean(report && report.messages.length > 1);

  const tabs = useMemo<TabDef<Tab>[]>(() => {
    if (!report) return [];
    const issues = report.messages.filter((m) => worstSeverity(m.result)).length;
    const msgs: TabDef<Tab> = {
      id: "messages",
      label: report.messages.length > 1 ? "Messages" : "Message",
      icon: ListMagnifyingGlassIcon,
      n: report.messages.length > 1 ? report.messages.length : undefined,
    };
    const files: TabDef<Tab>[] = report.capture?.files?.length ? [{ id: "files", label: "Files", icon: FilesIcon, n: report.capture.files.length }] : [];
    if (!report.session) return [msgs, ...files];
    if (report.messages.length <= 1) return [msgs, { id: "context", label: "Context", icon: IdentificationCardIcon }, ...files];
    const t: TabDef<Tab>[] = [
      { id: "summary", label: "Summary", icon: SparkleIcon, n: issues || undefined, alert: issues > 0 },
      { id: "flow", label: "Signalling flow", icon: FlowArrowIcon },
      msgs,
    ];
    if (report.session.radio.points.length || report.session.radio.modem?.points.length) t.push({ id: "radio", label: "Radio", icon: ChartLineIcon });
    t.push({ id: "context", label: "Context", icon: IdentificationCardIcon });
    t.push(...files);
    return t;
  }, [report]);

  // j / k step through the messages when the focus is not in a text field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (view !== "results" || !report || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el.closest("input, textarea, [role=listbox], [contenteditable]")) return;
      if (e.key === "j" || e.key === "k") {
        setSelected((s) => Math.max(0, Math.min(report.messages.length - 1, s + (e.key === "j" ? 1 : -1))));
        setTab("messages");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [report, view]);

  if (view === "home") {
    return (
      <Landing
        input={{
          text: draft,
          setText: setDraft,
          protocol,
          setProtocol,
          split,
          setSplit,
          onDecode: () => run(draft, { title: "Pasted log" }),
          decoding,
          engineReady: engineState.stage === "ready",
        }}
        onFile={(name, text) => run(text, { title: name, chip: "File" })}
        onCapture={runCapture}
        onSample={(title, text) => run(text, { title, chip: "Example" }, { protocol: "auto", split: "auto" })}
        resume={report ? { label: "Back to the results", onResume: showResults } : null}
      />
    );
  }

  const entry = report?.messages[selected];
  const k = report?.session?.kpis;
  const meta = decoding
    ? phase
      ? `${phase}…`
      : engineState.stage === "ready"
        ? "Decoding…"
        : `${engineState.label}…`
    : error
      ? "Decoding stopped"
      : report
        ? [
            `${report.messages.length} ${report.messages.length === 1 ? "message" : "messages"}`,
            k?.rats.length ? k.rats.join(" and ") : report.messages.length === 1 && entry?.result.ok ? protocolShort(entry.result) : null,
            k?.durationMs ? `${fmtMs(k.durationMs)} of log` : null,
            k && k.critical ? `${k.critical} ${k.critical === 1 ? "failure" : "failures"}` : null,
            report.capture?.span?.date ? `logged ${report.capture.span.date}` : null,
            "decoded on this computer",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";

  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar
        title={source.title}
        chip={source.chip}
        meta={meta}
        tabs={tabs}
        tab={tab}
        onTab={pickTab}
        onHome={goHome}
        onCopy={
          report
            ? async () => (await copyText(reportToMarkdown(report))) && toast.success("Report copied. Paste it into a ticket or an email.")
            : undefined
        }
        onJson={report ? () => downloadFile("3gpp-decode.json", JSON.stringify(report, null, 2)) : undefined}
      />
      <main className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-5 px-[clamp(12px,2.4vw,24px)] py-5">
        {error ? (
          <div role="alert" className="surface flex flex-wrap items-start gap-3 rounded-2xl p-4 shadow-[inset_0_3px_0_var(--st-bad),var(--lift)]">
            <WarningCircleIcon weight="fill" className="mt-0.5 size-5 shrink-0 text-critical" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-foreground">Decoding stopped</p>
              <p className="mt-0.5 text-[14px] text-ink-2">{error}</p>
            </div>
            <button
              onClick={goHome}
              className="press inline-flex h-[38px] items-center gap-2 rounded-[11px] border border-line-2 bg-white/70 px-4 text-[13.5px] font-semibold text-foreground hover:bg-hover-2"
            >
              <HouseIcon weight="bold" className="size-[18px]" /> Home
            </button>
          </div>
        ) : null}
        {decoding && !report ? <ResultSkeleton phase={phase} /> : null}
        {failedCapture && !report ? <FilesView capture={failedCapture} /> : null}
        {report && entry ? (
          <>
            {tab === "summary" && report.session ? <SummaryView report={report} onOpen={openMessage} onTab={pickTab} /> : null}
            {tab === "files" && report.capture ? <FilesView capture={report.capture} /> : null}
            {tab === "flow" && report.session ? <FlowView session={report.session} selected={selected} onOpen={openMessage} /> : null}
            {tab === "messages" ? (
              <div className={cn("grid grid-cols-1 items-start gap-4", multi && "lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]")}>
                {multi ? (
                  <aside className="surface flex max-h-[46vh] min-h-0 flex-col overflow-hidden rounded-2xl lg:sticky lg:top-[124px] lg:max-h-[calc(100dvh-140px)]">
                    <MessageList
                      messages={report.messages}
                      selected={selected}
                      onSelect={openMessage}
                      issuesOnly={issuesOnly}
                      setIssuesOnly={setIssuesOnly}
                    />
                  </aside>
                ) : null}
                <MessageView
                  entry={entry}
                  total={report.messages.length}
                  onPrev={() => setSelected((s) => Math.max(0, s - 1))}
                  onNext={() => setSelected((s) => Math.min(report.messages.length - 1, s + 1))}
                  onOpen={openMessage}
                  onRetry={goHome}
                />
              </div>
            ) : null}
            {tab === "radio" && report.session ? <RadioView session={report.session} onOpen={openMessage} /> : null}
            {tab === "context" && report.session ? <ContextView session={report.session} onOpen={openMessage} /> : null}
          </>
        ) : null}
        <SiteFooter className="no-print mt-auto" />
      </main>
    </div>
  );
}
