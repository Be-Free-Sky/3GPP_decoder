import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BugIcon,
  ChartLineIcon,
  CircleNotchIcon,
  FilesIcon,
  FlowArrowIcon,
  FoldersIcon,
  HouseIcon,
  IdentificationCardIcon,
  ListMagnifyingGlassIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { engine } from "@/lib/engine/client";
import { crashFound, searchedCount, type CaptureInfo, type Report, type SplitMode } from "@/lib/engine/types";
import { splitLogs, type CaptureSource } from "@/lib/capture";
import { analyseLog, fleetOverview, logVerdict, type FleetLog } from "@/lib/fleet";
import { crashTone } from "@/lib/crashes";
import { downloadFile, fmtMs, protocolShort, worstSeverity } from "@/lib/format";
import { reportToMarkdown } from "@/lib/report-md";
import {
  TAB_TITLE,
  copyHtml,
  embeddedReport,
  emailHtml,
  fileHtml,
  fleetEmailHtml,
  fleetFileHtml,
  fleetWithoutFiles,
  viewerHtml,
  withoutFiles,
  type ReportTab,
} from "@/lib/report-html";
import { AppBar, type TabDef } from "./app-bar";
import { Landing } from "./landing";
import { MessageList } from "./message-list";
import { MessageView } from "./message-view";
import { SummaryView } from "./summary-view";
import { FlowView } from "./flow-view";
import { RadioView } from "./radio-view";
import { ContextView } from "./context-view";
import { FilesView } from "./files-view";
import { FleetView } from "./fleet-view";
import { CrashView } from "./crash-view";
import { SiteFooter } from "./brand";
import { useEngineState } from "./engine-status";
import { cn } from "@/lib/utils";

type Tab = "fleet" | "summary" | "flow" | "messages" | "radio" | "context" | "crashes" | "files";
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

/** Where a fresh report opens: the summary of a session, the message itself, or the crash when that is all there is. */
const startTab = (rep: Report): Tab =>
  rep.messages.length > 1 && rep.session ? "summary" : crashFound(rep.capture?.crashes) || !rep.messages.length ? "crashes" : "messages";
const firstIssue = (rep: Report) => rep.messages.find((m) => worstSeverity(m.result))?.index ?? 0;

/** A shared HTML report: this app opened on a finished analysis, with no decoder and no home page. */
const SHARED = typeof window === "undefined" ? null : embeddedReport();

export function DecoderApp() {
  // The home page box starts empty every time; examples and files never fill it.
  const [draft, setDraft] = useState("");
  const [protocol, setProtocol] = useState("auto");
  const [split, setSplit] = useState<SplitMode>("auto");
  const [report, setReport] = useState<Report | null>(SHARED?.report ?? null);
  const [source, setSource] = useState<Source>(SHARED ? { title: SHARED.meta.title, chip: SHARED.meta.chip } : { title: "Pasted log" });
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(SHARED?.report ? firstIssue(SHARED.report) : 0);
  const [tab, setTab] = useState<Tab>(SHARED?.fleet ? "fleet" : SHARED?.report ? startTab(SHARED.report) : "summary");
  // several logs at once: one entry per _armlog folder
  const [fleet, setFleet] = useState<FleetLog[] | null>(SHARED?.fleet ?? null);
  const [fleetName, setFleetName] = useState(SHARED?.fleet ? SHARED.meta.title : "");
  const [fleetRunning, setFleetRunning] = useState(false);
  const [openLog, setOpenLog] = useState<number | null>(null);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [view, setView] = useState<View>(SHARED ? "results" : "home");
  const [phase, setPhase] = useState<string | null>(null);
  const [failedCapture, setFailedCapture] = useState<CaptureInfo | null>(null);
  const [copying, setCopying] = useState(false);
  const engineState = useEngineState();
  const hasResults = useRef(Boolean(SHARED));
  const runId = useRef(0);

  useEffect(() => {
    if (!SHARED) engine.boot();
  }, []);

  // Browser Back from the results returns to the home page.
  useEffect(() => {
    if (SHARED) return;
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
      setFleet(null);
      setFleetRunning(false);
      setOpenLog(null);
      showResults();
      return id;
    },
    [showResults],
  );

  const finish = useCallback((rep: Report) => {
    setReport(rep);
    hasResults.current = true;
    setSelected(firstIssue(rep));
    setTab(startTab(rep));
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

  /** Several logs: read each _armlog folder in turn and keep the result of every one. */
  const runFleet = useCallback(
    async (name: string, logs: CaptureSource[]) => {
      const id = begin({ title: name, chip: `${logs.length} logs` });
      setDecoding(false);
      setFleetName(name);
      setFleet(logs.map((l) => ({ name: l.name, status: "waiting", size: l.size, fileCount: l.files.length })));
      setFleetRunning(true);
      setTab("fleet");
      hasResults.current = true;
      const update = (i: number, patch: Partial<FleetLog>) =>
        setFleet((all) => (all ? all.map((x, k) => (k === i ? { ...x, ...patch } : x)) : all));
      try {
        for (let i = 0; i < logs.length; i++) {
          if (id !== runId.current) return;
          update(i, { status: "reading", phase: "Opening the folder" });
          try {
            const res = await analyseLog(logs[i], (t) => id === runId.current && update(i, { phase: t }));
            if (id !== runId.current) return;
            update(i, res.report ? { status: "done", report: res.report, info: res.info, phase: undefined } : { status: "failed", error: res.error, info: res.info, phase: undefined });
          } catch (e) {
            if (id !== runId.current) return;
            update(i, { status: "failed", error: e instanceof Error ? e.message : String(e), phase: undefined });
          }
        }
      } finally {
        if (id === runId.current) setFleetRunning(false);
      }
    },
    [begin],
  );

  /** A Logel capture: zip, folder or loose files. Several _armlog folders are read one by one. */
  const runCapture = useCallback(
    async (cap: CaptureSource) => {
      const logs = splitLogs(cap);
      if (logs.length > 1) return runFleet(cap.name, logs);
      const id = begin({ title: cap.name, chip: cap.kind === "zip" ? "Zip" : cap.kind === "folder" ? "Folder" : "Logel log" });
      try {
        setPhase(cap.kind === "zip" ? `Opening ${cap.name}.zip` : `Opening ${cap.name}`);
        const res = await analyseLog(cap, (t) => id === runId.current && setPhase(t));
        if (id !== runId.current) return;
        if (!res.report) {
          setFailedCapture(res.info);
          setError(`${res.error ?? "This log could not be analysed."} The files that were found are listed below.`);
          return;
        }
        finish(res.report);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runId.current) {
          setDecoding(false);
          setPhase(null);
        }
      }
    },
    [begin, finish, runFleet],
  );

  /** Open one folder of several: its own summary, flow, messages and radio. */
  const openFleetLog = useCallback(
    (i: number) => {
      const l = fleet?.[i];
      if (!l?.report) return;
      setOpenLog(i);
      setReport(l.report);
      setSource({ title: l.name, chip: `Log ${i + 1} of ${fleet!.length}` });
      setSelected(firstIssue(l.report));
      setTab(startTab(l.report));
      setIssuesOnly(false);
      window.scrollTo({ top: 0 });
    },
    [fleet],
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

  const fleetTab = useMemo<TabDef<Tab>[]>(() => {
    if (!fleet) return [];
    const o = fleetOverview(fleet);
    return [{ id: "fleet", label: "All logs", icon: FoldersIcon, n: fleet.length, alert: o.issues.length > 0 }];
  }, [fleet]);

  const reportTabs = useMemo<TabDef<Tab>[]>(() => {
    if (!report) return [];
    const issues = report.messages.filter((m) => worstSeverity(m.result)).length;
    const msgs: TabDef<Tab> = {
      id: "messages",
      label: report.messages.length > 1 ? "Messages" : "Message",
      icon: ListMagnifyingGlassIcon,
      n: report.messages.length > 1 ? report.messages.length : undefined,
    };
    // every file of a capture is searched for asserts: the tab says so even when none was found
    const crashes = report.capture?.crashes;
    const crashN = crashes ? crashes.events.length || crashes.groups.filter((g) => g.strong && !g.explained).length : 0;
    const files: TabDef<Tab>[] = [
      ...(searchedCount(crashes) ? [{ id: "crashes" as Tab, label: "Asserts", icon: BugIcon, n: crashN || undefined, alert: crashTone(crashes) === "bad" }] : []),
      ...(report.capture?.files?.length ? [{ id: "files" as Tab, label: "Files", icon: FilesIcon, n: report.capture.files.length }] : []),
    ];
    if (!report.messages.length) return [...files, ...(report.session ? [{ id: "context" as Tab, label: "Context", icon: IdentificationCardIcon }] : [])];
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

  const tabs = [...fleetTab, ...(fleet && openLog === null ? [] : reportTabs)];

  // j / k step through the messages when the focus is not in a text field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (view !== "results" || !report?.messages.length || tab === "fleet" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el.closest("input, textarea, [role=listbox], [contenteditable]")) return;
      if (e.key === "j" || e.key === "k") {
        setSelected((s) => Math.max(0, Math.min(report.messages.length - 1, s + (e.key === "j" ? 1 : -1))));
        setTab("messages");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [report, view, tab]);

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
        resume={report || fleet ? { label: "Back to the results", onResume: showResults } : null}
      />
    );
  }

  const entry = report?.messages[selected];
  const k = report?.session?.kpis;
  const meta = SHARED?.report
    ? SHARED.meta.meta
    : decoding
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
            SHARED ? null : "decoded on this computer",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";

  const onFleet = tab === "fleet" && Boolean(fleet);
  const fleetSummary = fleet ? fleetOverview(fleet) : null;
  const fleetMeta =
    fleet && fleetSummary
      ? [
          `${fleet.length} logs`,
          fleetSummary.issues.length ? `issues in ${fleetSummary.issues.length}` : null,
          fleetSummary.counts.ok ? `${fleetSummary.counts.ok} all good` : null,
          fleetSummary.counts.none ? `${fleetSummary.counts.none} not analysed` : null,
          fleetRunning ? `reading ${Math.min(fleet.length - fleetSummary.counts.busy + 1, fleet.length)} of ${fleet.length}…` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const barTitle = onFleet ? fleetName : source.title;
  const barChip = onFleet ? `${fleet!.length} logs` : source.chip;
  const barMeta = onFleet ? (SHARED ? SHARED.meta.meta : fleetMeta) : meta;
  const reportMeta = { title: barTitle, chip: barChip, meta: barMeta.replace(/ · decoded on this computer$/, "") };

  /** The page on screen, as HTML with its colours and cards, for Outlook / Teams. */
  async function copyPage(which: Tab) {
    if (which === "fleet" ? !fleet : !report) return;
    setCopying(true);
    try {
      const html = which === "fleet" ? fleetEmailHtml(fleet!) : await emailHtml(report!, which as ReportTab, selected);
      const text =
        which === "fleet"
          ? [fleetOverview(fleet!).head, "", ...fleet!.map((l) => `- ${l.name}: ${logVerdict(l).word}. ${logVerdict(l).head}`)].join("\n")
          : reportToMarkdown(report!);
      const ok = await copyHtml(html, text);
      if (ok) toast.success(`Copied the ${which === "fleet" ? "All logs" : TAB_TITLE[which as ReportTab]} page. Paste it into Outlook, Teams or a ticket.`);
      else toast.error("The browser did not allow copying. Use HTML report to download it instead.");
    } catch (e) {
      toast.error(`Could not copy: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCopying(false);
    }
  }

  /** The whole analysis as one HTML file to share: the same pages, without the list of files.
   *  With several logs it holds every log, opening on the All logs page. */
  function downloadReport() {
    if (!report && !fleet) return;
    const title = fleet ? fleetName : source.title;
    const meta = fleet ? { title: fleetName, chip: `${fleet.length} logs`, meta: fleetMeta } : reportMeta;
    const base = title.replace(/\.(txt|log|hex|zip|logel)$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 80) || "3gpp";
    let html: string;
    if (fleet) {
      const logs = fleetWithoutFiles(fleet);
      html = viewerHtml({ fleet: logs }, meta) ?? fleetFileHtml(logs, meta);
    } else {
      const shared = withoutFiles(report!);
      html = viewerHtml({ report: shared }, meta) ?? fileHtml(shared, meta);
    }
    downloadFile(`${base}-3GPP-report.html`, html, "text/html");
    toast.success("HTML report downloaded. It opens in any browser and looks like this page.");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppBar
        title={barTitle}
        chip={barChip}
        meta={barMeta}
        tabs={tabs}
        tab={tab}
        onTab={pickTab}
        onHome={SHARED ? undefined : goHome}
        onCopy={(report || onFleet) && !SHARED ? () => copyPage(tab) : undefined}
        onReport={(report || fleet) && !SHARED && !fleetRunning ? downloadReport : undefined}
        copying={copying}
        onJson={report && !SHARED && !onFleet ? () => downloadFile("3gpp-decode.json", JSON.stringify(report, null, 2)) : undefined}
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
        {onFleet ? <FleetView logs={fleet!} onOpen={openFleetLog} /> : null}
        {report && !onFleet ? (
          <>
            {tab === "summary" && report.session ? (
              <SummaryView
                report={report}
                onOpen={openMessage}
                onTab={pickTab}
                onCopy={SHARED ? undefined : () => copyPage("summary")}
                onReport={SHARED ? undefined : downloadReport}
              />
            ) : null}
            {tab === "files" && report.capture ? <FilesView capture={report.capture} /> : null}
            {tab === "crashes" && report.capture ? <CrashView capture={report.capture} messages={report.messages} onOpen={openMessage} /> : null}
            {tab === "flow" && report.session ? <FlowView session={report.session} selected={selected} onOpen={openMessage} /> : null}
            {tab === "messages" && entry ? (
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
