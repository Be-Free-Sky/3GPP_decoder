import { CheckCircleIcon, FilesIcon, GlobeIcon, InfoIcon, MinusCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import type { CaptureFileInfo, CaptureInfo } from "@/lib/engine/types";
import { sizeText } from "@/lib/capture";
import { CardHead } from "./summary-view";
import { cn } from "@/lib/utils";

const ROLE = {
  analysed: { title: "Analysed", sub: "Read in full: what each file holds, and what was found in it.", icon: CheckCircleIcon, chip: "bg-ok-soft text-ok-ink", mark: "text-ok" },
  info: { title: "Read for information", sub: "Versions and log statistics.", icon: InfoIcon, chip: "bg-info-soft text-info-ink", mark: "text-blue" },
  skipped: { title: "Empty", sub: "Nothing was logged to them (or they could not be opened); listed so you know each was checked.", icon: MinusCircleIcon, chip: "bg-sunken text-ink-2", mark: "text-muted-foreground" },
} as const;

function FileRow({ f }: { f: CaptureFileInfo }) {
  const R = ROLE[f.role];
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3.5 py-3 sm:grid-cols-[22px_minmax(0,1fr)_auto]">
      <R.icon weight="fill" className={cn("mt-0.5 size-[18px]", R.mark)} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all font-mono text-[13px] font-semibold text-foreground">{f.name}</span>
          <span className={cn("rounded-full px-2 py-px text-[11.5px] font-bold", R.chip)}>{f.label}</span>
        </div>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{f.reason}</p>
        {f.detail ? <p className="mt-0.5 text-[13px] font-medium text-foreground">{f.detail}</p> : null}
        {f.path.split("/").length > 2 ? <p className="mt-0.5 break-all font-mono text-[11.5px] text-muted-foreground">in {f.path.split("/").slice(0, -1).join("/")}</p> : null}
      </div>
      <span className="col-start-2 font-mono text-[12.5px] tabular-nums text-muted-foreground sm:col-start-3 sm:text-right">{sizeText(f.size)}</span>
    </li>
  );
}

/** Several skipped files with the same reason, as one row. */
function GroupRow({ list }: { list: CaptureFileInfo[] }) {
  const R = ROLE.skipped;
  const labels = [...new Set(list.map((f) => f.label))];
  const total = list.reduce((n, f) => n + f.size, 0);
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3.5 py-3 sm:grid-cols-[22px_minmax(0,1fr)_auto]">
      <R.icon weight="fill" className={cn("mt-0.5 size-[18px]", R.mark)} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13.5px] font-semibold text-foreground">{list.length} files</span>
          {labels.slice(0, 4).map((l) => (
            <span key={l} className={cn("rounded-full px-2 py-px text-[11.5px] font-bold", R.chip)}>
              {l}
            </span>
          ))}
        </div>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{list[0].reason}</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {list.map((f) => (
            <li key={f.path} className="break-all rounded-md border border-border bg-panel px-1.5 py-px font-mono text-[11.5px] text-ink-2" title={f.path}>
              {f.name}
            </li>
          ))}
        </ul>
      </div>
      <span className="col-start-2 font-mono text-[12.5px] tabular-nums text-muted-foreground sm:col-start-3 sm:text-right">{sizeText(total)}</span>
    </li>
  );
}

function grouped(list: CaptureFileInfo[]) {
  const by = new Map<string, CaptureFileInfo[]>();
  for (const f of list) by.set(f.reason, [...(by.get(f.reason) ?? []), f]);
  return [...by.values()].sort((a, b) => b.reduce((n, f) => n + f.size, 0) - a.reduce((n, f) => n + f.size, 0));
}

export function FilesSummary({ capture, onAll }: { capture: CaptureInfo; onAll: () => void }) {
  const files = capture.files ?? [];
  const used = files.filter((f) => f.role === "analysed");
  const info = files.filter((f) => f.role === "info");
  return (
    <section className="surface rounded-2xl px-[18px] py-4">
      <CardHead
        icon={FilesIcon}
        title="Files in this log"
        sub={`${files.length} ${files.length === 1 ? "file" : "files"}: ${used.length + info.length} analysed, ${files.length - used.length - info.length} empty.`}
        aside={
          <button onClick={onAll} className="text-[13px] font-bold text-link underline underline-offset-[3px] hover:no-underline">
            See every file
          </button>
        }
      />
      <ul className="divide-y divide-border rounded-[12px] border border-border bg-panel-2">
        {used.concat(info).slice(0, 8).map((f) => (
          <FileRow key={f.path} f={f} />
        ))}
      </ul>
      {used.length + info.length > 8 ? (
        <button onClick={onAll} className="mt-2 text-[13px] font-semibold text-link underline underline-offset-[3px] hover:no-underline">
          and {used.length + info.length - 8} more analysed {used.length + info.length - 8 === 1 ? "file" : "files"}
        </button>
      ) : null}
    </section>
  );
}

const RCODE: Record<number, string> = { 0: "Answered", 1: "Format error", 2: "Server failure", 3: "No such name", 4: "Not implemented", 5: "Refused" };

export function FilesView({ capture }: { capture: CaptureInfo }) {
  const files = capture.files ?? [];
  const ip = capture.ip;
  const groups = (["analysed", "info", "skipped"] as const).map((r) => ({ r, list: files.filter((f) => f.role === r) })).filter((g) => g.list.length);
  return (
    <div className="flex flex-col gap-4">
      <section className="surface rounded-2xl px-[18px] py-4">
        <CardHead
          icon={FilesIcon}
          title={`Files in ${capture.name ?? "this log"}`}
          sub="Every file in the log, each read with the reader for its kind and searched line by line for asserts and crashes. A file of a kind this page does not know is still searched and described."
        />
        <div className="flex flex-col gap-4">
          {groups.map(({ r, list }) => {
            const R = ROLE[r];
            return (
              <div key={r}>
                <h3 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-foreground">
                  {R.title}
                  <span className="rounded-full bg-hover-2 px-[7px] py-px font-mono text-[11px] font-semibold text-ink-2">{list.length}</span>
                  <span className="text-[12.5px] font-medium text-muted-foreground">{R.sub}</span>
                </h3>
                <ul className="divide-y divide-border rounded-[12px] border border-border bg-panel-2">
                  {r === "skipped"
                    ? grouped(list).map((g) => (g.length === 1 ? <FileRow key={g[0].path} f={g[0]} /> : <GroupRow key={g[0].reason} list={g} />))
                    : list.map((f) => <FileRow key={f.path} f={f} />)}
                </ul>
              </div>
            );
          })}
        </div>
        {capture.notes?.length ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {capture.notes.map((n) => (
              <li key={n} className="flex gap-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[13.5px] text-warning-ink">
                <InfoIcon weight="bold" className="mt-0.5 size-4 shrink-0" />
                {n}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {ip ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead
            icon={GlobeIcon}
            title="IP traffic"
            sub={`${ip.packets} packets from ${ip.first ?? "?"} to ${ip.last ?? "?"}: ${ip.ul} up, ${ip.dl} down, ${ip.tcp} TCP, ${ip.udp} UDP, ${ip.icmp} ICMP.`}
          />
          {ip.dns.length ? (
            <div className="overflow-x-auto rounded-[12px] border border-border bg-panel scrollbar-thin">
              <table className="w-full min-w-[560px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-border bg-panel-2 text-[12px] text-muted-foreground">
                    <th className="px-3.5 py-2 font-semibold">Time</th>
                    <th className="px-3 py-2 font-semibold">DNS lookup</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Result</th>
                    <th className="px-3 py-2 text-right font-semibold">Answer time</th>
                  </tr>
                </thead>
                <tbody>
                  {ip.dns.map((q, i) => {
                    const bad = q.answered === false || (q.rcode != null && q.rcode !== 0);
                    return (
                      <tr key={i} className="even:bg-[rgb(11_27_52/0.022)]">
                        <td className="px-3.5 py-2 font-mono text-[12.5px] text-ink-2">{q.ts}</td>
                        <td className="break-all px-3 py-2 font-mono text-[12.5px] font-semibold text-foreground">{q.name}</td>
                        <td className="px-3 py-2 text-ink-2">{q.type}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-px text-[12px] font-bold",
                              bad ? "bg-critical-soft text-critical-ink" : q.answered ? "bg-ok-soft text-ok-ink" : "bg-sunken text-ink-2",
                            )}
                          >
                            {bad ? <XCircleIcon weight="bold" className="size-3.5" /> : null}
                            {q.answered === false
                              ? "No answer"
                              : q.answered
                                ? `${RCODE[q.rcode ?? 0] ?? `Error ${q.rcode}`}${q.rcode === 0 ? `, ${q.answers} ${q.answers === 1 ? "record" : "records"}` : ""}`
                                : "Capture ended"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[12.5px] text-ink-2">{q.rttMs != null ? `${q.rttMs} ms` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">No DNS lookups in the capture.</p>
          )}
          {ip.servers.length ? (
            <p className="mt-2.5 text-[13px] text-ink-2">
              DNS servers used: <span className="font-mono font-semibold text-foreground">{ip.servers.join(", ")}</span>
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
