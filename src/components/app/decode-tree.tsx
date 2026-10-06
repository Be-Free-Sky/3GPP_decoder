"use client";

import { createContext, memo, useContext, useMemo, useState } from "react";
import {
  ArrowSquareOutIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretRightIcon,
  CopyIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { TreeNode } from "@/lib/engine/types";
import { QUALITY_TEXT, copyText } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TreeCtx {
  expanded: Set<string>;
  toggle: (p: string) => void;
  spec: boolean;
  visible: Set<string> | null;
  hits: Set<string> | null;
  onEmbedded?: (i: number) => void;
}

const Ctx = createContext<TreeCtx | null>(null);

const TAG_TONE: Record<string, string> = {
  pci: "text-brand-2",
  earfcn: "text-brand-2",
  nrarfcn: "text-brand-2",
  band: "text-brand-2",
  plmn: "text-brand-2",
  tac: "text-brand-2",
  cellid: "text-brand-2",
  imsi: "text-brand-2",
  guti: "text-brand-2",
  tmsi: "text-brand-2",
  suci: "text-brand-2",
};

function pathOf(parent: string, node: TreeNode, i: number) {
  return `${parent}/${i}:${node.k}`;
}

function collectPaths(node: TreeNode, path: string, depth: number, maxDepth: number, out: Set<string>) {
  if (!node.c?.length) return;
  if (depth < maxDepth) out.add(path);
  node.c.forEach((c, i) => collectPaths(c, pathOf(path, c, i), depth + 1, maxDepth, out));
}

function defaultExpanded(root: TreeNode): Set<string> {
  const out = new Set<string>();
  // open the first two levels, and any small subtree below that
  const walk = (n: TreeNode, path: string, depth: number) => {
    if (!n.c?.length) return;
    if (depth < 2 || (depth < 5 && n.c.length <= 4 && !n.n)) out.add(path);
    n.c.forEach((c, i) => walk(c, pathOf(path, c, i), depth + 1));
  };
  walk(root, "r", 0);
  return out;
}

function search(root: TreeNode, q: string) {
  const visible = new Set<string>();
  const hits = new Set<string>();
  const needle = q.toLowerCase();
  const walk = (n: TreeNode, path: string, ancestors: string[]): boolean => {
    const text = `${n.l} ${n.k} ${n.v ?? ""} ${n.h ?? ""} ${n.chl ?? ""}`.toLowerCase();
    let found = text.includes(needle);
    if (found) hits.add(path);
    n.c?.forEach((c, i) => {
      if (walk(c, pathOf(path, c, i), [...ancestors, path])) found = true;
    });
    if (found) {
      visible.add(path);
      ancestors.forEach((a) => visible.add(a));
    }
    return found;
  };
  walk(root, "r", []);
  return { visible, hits };
}

const Row = memo(function Row({ node, path, depth }: { node: TreeNode; path: string; depth: number }) {
  const ctx = useContext(Ctx)!;
  if (ctx.visible && !ctx.visible.has(path)) return null;
  const kids = node.c ?? [];
  const hasKids = kids.length > 0;
  const open = ctx.visible ? true : ctx.expanded.has(path);
  const label = ctx.spec ? node.k : node.l;
  const sub = ctx.spec ? (node.l !== node.k ? node.l : null) : node.k !== node.l && !node.k.startsWith("[") ? node.k : null;
  const value = node.v;
  const hint = node.h;
  const hit = ctx.hits?.has(path);

  return (
    <div role="treeitem" aria-selected={false} aria-expanded={hasKids ? open : undefined} aria-level={depth + 1}>
      <div
        className={cn(
          "group flex min-h-7 items-start gap-1.5 rounded-md py-[3px] pr-2 transition-colors duration-100 hover:bg-muted/80",
          hit && "bg-brand-3/[0.09]",
        )}
        style={{ paddingLeft: depth * 16 + 4 }}
      >
        {hasKids ? (
          <button
            onClick={() => ctx.toggle(path)}
            className="mt-[3px] grid size-[18px] shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={open ? `Collapse ${node.l}` : `Expand ${node.l}`}
          >
            <CaretRightIcon weight="bold" className={cn("size-3 transition-transform duration-150 ease-(--ease-out)", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-[18px] shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn("text-[13px] text-foreground", hasKids ? "font-medium" : "", ctx.spec && "font-mono text-[12px]")}
            onClick={hasKids ? () => ctx.toggle(path) : undefined}
          >
            {label}
          </span>
          {node.r ? (
            <span className="rounded border border-border px-1 font-mono text-[10px] leading-4 text-muted-foreground">{node.r}</span>
          ) : null}
          {node.chl ? <span className="text-[12px] text-brand-2">{node.chl}</span> : null}
          {node.n != null ? <span className="text-[11px] tabular-nums text-muted-foreground">{node.n} items</span> : null}
          {value != null && !(node.chl && hasKids) ? (
            <button
              onClick={async () => {
                if (await copyText(node.x ?? value)) toast.success(`Copied ${node.l}`);
              }}
              className="group/v inline-flex max-w-full items-baseline gap-1 rounded px-1 text-left font-mono text-[12px] text-foreground/85 hover:bg-accent"
              title="Copy value"
            >
              <span className="break-all">{value}</span>
              <CopyIcon className="size-3 shrink-0 self-center opacity-0 transition-opacity duration-100 group-hover/v:opacity-60" />
            </button>
          ) : null}
          {hint ? (
            <span
              className={cn(
                "text-[12px]",
                node.q ? cn(QUALITY_TEXT[node.q], "font-medium") : node.tag && TAG_TONE[node.tag] ? TAG_TONE[node.tag] : "text-muted-foreground",
              )}
            >
              {hint}
            </span>
          ) : null}
          {node.emb != null && ctx.onEmbedded ? (
            <button
              onClick={() => ctx.onEmbedded!(node.emb!)}
              className="inline-flex items-center gap-1 rounded-full border border-brand-3/30 bg-brand-3/[0.08] px-2 text-[11px] font-medium leading-5 text-brand-2 hover:bg-brand-3/[0.14]"
            >
              <ArrowSquareOutIcon className="size-3" /> Decoded content
            </button>
          ) : null}
          {sub ? <span className="hidden font-mono text-[10.5px] text-muted-foreground/80 group-hover:inline">{sub}</span> : null}
        </div>
      </div>
      {hasKids && open ? (
        <div role="group" className="relative">
          <span aria-hidden className="absolute inset-y-0 w-px bg-hairline" style={{ left: depth * 16 + 12 }} />
          {kids.map((c, i) => (
            <Row key={i} node={c} path={pathOf(path, c, i)} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
});

export function DecodeTree({
  root,
  onEmbedded,
  compact,
}: {
  root: TreeNode;
  onEmbedded?: (i: number) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(() => defaultExpanded(root));
  const [spec, setSpec] = useState(false);
  const [query, setQuery] = useState("");
  const found = useMemo(() => (query.trim().length >= 2 ? search(root, query.trim()) : null), [root, query]);

  const ctx: TreeCtx = {
    expanded,
    toggle: (p) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(p)) next.delete(p);
        else next.add(p);
        return next;
      }),
    spec,
    visible: found?.visible ?? null,
    hits: found?.hits ?? null,
    onEmbedded,
  };

  const expandAll = () => {
    const all = new Set<string>();
    collectPaths(root, "r", 0, 40, all);
    setExpanded(all);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <label className="sr-only" htmlFor={`tree-search-${compact ? "c" : "m"}`}>
            Search fields
          </label>
          <input
            id={`tree-search-${compact ? "c" : "m"}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fields and values"
            className="h-8 w-full rounded-lg border border-input bg-raised pl-8 pr-3 text-[13px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/80 focus-visible:border-brand-3 focus-visible:ring-3 focus-visible:ring-brand-3/20"
          />
        </div>
        <div role="radiogroup" aria-label="Field names" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {[
            { v: false, l: "Readable" },
            { v: true, l: "Spec names" },
          ].map((o) => (
            <button
              key={o.l}
              role="radio"
              aria-checked={spec === o.v}
              onClick={() => setSpec(o.v)}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-medium transition-[background-color,color] duration-150",
                spec === o.v ? "bg-white text-foreground shadow-[0_1px_2px_rgb(0_27_72/0.12)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={expandAll} className="text-muted-foreground">
          <ArrowsOutSimpleIcon /> Expand
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(["r"]))} className="text-muted-foreground">
          <ArrowsInSimpleIcon /> Collapse
        </Button>
      </div>
      {found && found.hits.size === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">No field or value matches &ldquo;{query}&rdquo;.</p>
      ) : null}
      <Ctx.Provider value={ctx}>
        <div role="tree" aria-label="Decoded fields" className="rounded-xl border border-border bg-raised p-1.5">
          <Row node={root} path="r" depth={0} />
        </div>
      </Ctx.Provider>
    </div>
  );
}
