import { CellTowerIcon, CopyIcon, DatabaseIcon, GlobeHemisphereEastIcon, SimCardIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { ContextItem, Session } from "@/lib/engine/types";
import { copyText } from "@/lib/format";
import { MsgRef } from "./bits";

const GROUPS = [
  { key: "network", title: "Network", icon: GlobeHemisphereEastIcon, empty: "No PLMN, TAC or cell identity in this log." },
  { key: "ue", title: "UE identity", icon: SimCardIcon, empty: "No IMSI, GUTI or TMSI in this log." },
  { key: "radio", title: "Radio", icon: CellTowerIcon, empty: "No band, bandwidth or mobility target in this log." },
  { key: "data", title: "Data session", icon: DatabaseIcon, empty: "No APN, DNN, IP address or QoS in this log." },
] as const;

export function ContextView({ session, onOpen }: { session: Session; onOpen: (i: number) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        Identities and settings collected from every decoded message, including NAS carried inside RRC. Each value links to the message it came
        from.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {GROUPS.map((g) => {
          const items: ContextItem[] = session.context[g.key];
          return (
            <section key={g.key} className="rounded-2xl border border-border bg-raised p-4">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <span className="grid size-7 place-items-center rounded-lg bg-brand-3/[0.1] text-brand-2">
                  <g.icon className="size-4" />
                </span>
                {g.title}
              </h3>
              {items.length === 0 ? (
                <p className="mt-3 text-[12.5px] text-muted-foreground">{g.empty}</p>
              ) : (
                <dl className="mt-3 flex flex-col gap-2.5">
                  {items.map((it, i) => (
                    <div key={`${it.label}-${i}`} className="group grid grid-cols-[110px_1fr_auto] items-start gap-3">
                      <dt className="pt-0.5 text-[12px] text-muted-foreground">{it.label}</dt>
                      <dd className="min-w-0">
                        <button
                          onClick={async () => (await copyText(it.value)) && toast.success(`Copied ${it.label}`)}
                          className="inline-flex max-w-full items-start gap-1.5 text-left font-mono text-[12.5px] text-foreground hover:text-brand-2"
                          title="Copy"
                        >
                          <span className="break-all">{it.value}</span>
                          <CopyIcon className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity duration-100 group-hover:opacity-60" />
                        </button>
                        {it.hint ? <div className="text-[11.5px] text-muted-foreground">{it.hint}</div> : null}
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
