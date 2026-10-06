export function HexView({ hex }: { hex: string }) {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  const rows: number[][] = [];
  for (let i = 0; i < bytes.length; i += 16) rows.push(bytes.slice(i, i + 16));
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-raised p-3 scrollbar-thin">
      <table className="font-mono text-[12px] leading-6">
        <thead className="sr-only">
          <tr>
            <th>Offset</th>
            <th>Bytes</th>
            <th>ASCII</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="pr-4 align-top tabular-nums text-muted-foreground">{(i * 16).toString(16).padStart(4, "0")}</td>
              <td className="pr-4 align-top">
                {r.map((b, j) => (
                  <span key={j} className={j === 8 ? "ml-2.5" : j ? "ml-1.5" : ""}>
                    {b.toString(16).padStart(2, "0").toUpperCase()}
                  </span>
                ))}
              </td>
              <td className="whitespace-pre align-top text-muted-foreground">
                {r.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
