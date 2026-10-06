import { CellTowerIcon, CopyIcon, DatabaseIcon, GlobeHemisphereEastIcon, SimCardIcon } from "@phosphor-icons/react";
import { CardHead } from "./summary-view";
import { toast } from "sonner";
import type { ContextItem, Session } from "@/lib/engine/types";
import { copyText } from "@/lib/format";
import { MsgRef } from "./bits";

const GROUPS = [
  { key: "network", title: "Network", sub: "Operator, tracking area and cells.", icon: GlobeHemisphereEastIcon, empty: "No PLMN, TAC or cell identity in this log." },
  { key: "ue", title: "UE identity", sub: "Subscriber and temporary identities.", icon: SimCardIcon, empty: "No IMSI, GUTI or TMSI in this log." },
  { key: "radio", title: "Radio", sub: "Bands, bandwidth and mobility targets.", icon: CellTowerIcon, empty: "No band, bandwidth or mobility target in this log." },
  { key: "data", title: "Data session", sub: "APN or DNN, addresses and QoS.", icon: DatabaseIcon, empty: "No APN, DNN, IP address or QoS in this log." },
] as const;

export function ContextView({ session, onOpen }: { session: Session; onOpen: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {GROUPS.map((g) => {
          const items: ContextItem[] = session.context[g.key];
          return (
            <section key={g.key} className="surface rounded-2xl px-[18px] py-4">
              <CardHead icon={g.icon} title={g.title} sub={g.sub} />
              {items.length === 0 ? (
                <p className="rounded-[12px] border border-dashed border-line-2 px-3.5 py-3 text-[13.5px] text-muted-foreground">{g.empty}</p>
              ) : (
                <dl className="flex flex-col divide-y divide-border rounded-[12px] border border-border bg-panel-2">
                  {items.map((it, i) => (
                    <div key={`${it.label}-${i}`} className="group grid grid-cols-[120px_1fr_auto] items-start gap-3 px-3.5 py-2.5">
                      <dt className="pt-0.5 text-[13px] font-medium text-muted-foreground">{it.label}</dt>
                      <dd className="min-w-0">
                        <button
                          onClick={async () => (await copyText(it.value)) && toast.success(`Copied ${it.label}`)}
                          className="inline-flex max-w-full items-start gap-1.5 text-left font-mono text-[13px] font-semibold text-foreground hover:text-link"
                          title="Copy"
                        >
                          <span className="break-all">{it.value}</span>
                          <CopyIcon className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-60" />
                        </button>
                        {it.hint ? <div className="text-[12.5px] text-ink-2">{it.hint}</div> : null}
                      </dd>
                      <dd>
                        <MsgRef i={it.from} onOpen={onOpen} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
