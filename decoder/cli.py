"""Decode a log file from the command line (same engine as the website).

  python decoder/cli.py capture.txt                 # readable summary
  python decoder/cli.py capture.txt --json > out.json
  python decoder/cli.py - --protocol nas.5gs < hex.txt
"""

import argparse
import contextlib
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

with contextlib.redirect_stdout(io.StringIO()):
    import engine  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Skyworth 3GPP Decoder")
    ap.add_argument("file", help="text file with hex / Logel lines, or - for stdin")
    ap.add_argument("--protocol", default="auto", help="protocol id, e.g. lte-rrc.ul-dcch, nas.eps (default auto)")
    ap.add_argument("--split", default="auto", choices=["auto", "lines", "single"])
    ap.add_argument("--json", action="store_true", help="print the full JSON report")
    args = ap.parse_args()

    text = sys.stdin.read() if args.file == "-" else open(args.file, encoding="utf-8", errors="replace").read()
    with contextlib.redirect_stdout(io.StringIO()):
        report = engine.decode_text(text, args.protocol, args.split)
    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return
    for m in report["messages"]:
        r = m["result"]
        ts = f"{m['timestamp']} " if m.get("timestamp") else ""
        title = r["message"]["title"] if r.get("ok") else f"DECODE FAILED: {r.get('error')}"
        print(f"#{m['index'] + 1} {ts}{title}  [{r['protocol'].get('label', r['protocol'].get('id'))}]")
        if r.get("summary"):
            print(f"    {r['summary']}")
        for f in r.get("findings", []):
            if f["severity"] in ("critical", "warning"):
                print(f"    {f['severity'].upper()}: {f['title']}")
    s = report.get("session")
    if s and len(report["messages"]) > 1:
        print(f"\nVerdict: {s['verdict']}")
        root = s["narrative"].get("root")
        if root:
            print(f"Root cause: {root['title']}")
            for c in root.get("checks", []):
                print(f"  check: {c}")


if __name__ == "__main__":
    main()
