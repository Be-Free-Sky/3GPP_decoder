"""Modem log captures (UNISOC Logel armlog and similar).

The browser extracts the capture (zip / folder / .logel) and sends:

  records  RRC / NAS PDUs with the channel the modem logged and a timestamp
  radio    serving cell measurements from the modem's own traces
  at       AT command responses (+CESQ, +C5GREG, +COPS, +CGCONTRDP ...)
  ip       a summary of the IP packet capture (.cap): DNS lookups and traffic
  stats    the tool's lost-packet statistics
  device   modem / tool versions
  files    every file in the capture and what was done with it
  crashes  modem asserts and crashes: assert records (.ass), dumps, and every assert /
           crash / exception / reset line found in any file, grouped

decode_capture() decodes the PDUs with the logged channel (it is known, so no
guessing), runs the session analysis and folds the rest into it as findings,
context and a radio time series.
"""

import re

from . import catalog, radio
from .decode import decode_as

MAX_RECORDS = 5000


def decode_record(pid, data, fallback):
    """Decode with the channel the modem logged; fall back to detection."""
    if pid in catalog.BY_ID:
        res = decode_as(pid, data, direction=None)
        if res.get("ok"):
            # The channel is a fact of the log, not a guess: a re-encoding difference only means the
            # message uses an extension or padding that pycrate encodes differently.
            # padding after the message comes from the log record's 4-byte alignment
            res["warnings"] = [w for w in res.get("warnings", []) if "Re-encoding" not in w and "trailing zero byte" not in w]
            res["detection"] = {"mode": "log", "confidence": "high", "alternatives": []}
            return res
    return fallback(data)


# --- AT responses ---------------------------------------------------------------------

REG_STAT = {
    "0": ("not registered, not searching", "warning"),
    "1": ("registered, home network", "ok"),
    "2": ("searching for a network", "info"),
    "3": ("registration denied", "critical"),
    "4": ("unknown (out of coverage)", "warning"),
    "5": ("registered, roaming", "ok"),
    "8": ("emergency services only", "warning"),
}

ACT = {"0": "GSM", "2": "UTRAN", "7": "E-UTRAN (LTE)", "9": "E-UTRAN (NB-IoT)", "10": "E-UTRA on 5GC",
       "11": "NR on 5GC (5G SA)", "12": "NG-RAN", "13": "E-UTRA-NR dual connectivity (NSA)"}


def _split_args(s):
    out, cur, q = [], "", False
    for ch in s:
        if ch == '"':
            q = not q
            continue
        if ch == "," and not q:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    out.append(cur.strip())
    return out


def _cesq(args):
    """+CESQ (TS 27.007): ss_rsrq / ss_rsrp / ss_sinr indices -> dB / dBm."""
    out = {}
    if len(args) >= 9:
        try:
            rsrq, rsrp, sinr = int(args[6]), int(args[7]), int(args[8])
        except ValueError:
            return out
        if 0 < rsrp <= 127:
            out["rsrp"] = -157 + rsrp
        if 0 < rsrq <= 127:
            out["rsrq"] = round(-43 + (rsrq - 1) * 0.5, 1)
        if 0 < sinr <= 127:
            out["sinr"] = round(-23 + (sinr - 1) * 0.5, 1)
        out["rat"] = "NR"
    if not out and len(args) >= 6:
        try:
            rsrq, rsrp = int(args[4]), int(args[5])
        except ValueError:
            return out
        if 0 <= rsrp <= 97:
            out["rsrp"] = -141 + rsrp
        if 0 <= rsrq <= 34:
            out["rsrq"] = round(-20 + rsrq * 0.5, 1)
        if out:
            out["rat"] = "LTE"
    return out


def _parse_at(lines):
    """[{ts, line}] -> dict of parsed facts."""
    out = {"reg": [], "cesq": [], "cops": [], "pdp": [], "errors": []}
    for a in lines or []:
        line, ts = a.get("line", ""), a.get("ts")
        m = re.match(r"^\+(C5GREG|CEREG|CREG|CGREG):\s*(.*)$", line)
        if m:
            raw = [t.strip() for t in m.group(2).split(",")]
            # query response: <n>,<stat>[,"tac","ci",...]; unsolicited: <stat>[,"tac","ci",...]
            query = len(raw) >= 2 and raw[1].isdigit()
            args = _split_args(m.group(2))
            stat, rest = (args[1], args[2:]) if query else (args[0], args[1:])
            rec = {"ts": ts, "kind": m.group(1), "stat": stat}
            if len(rest) >= 2:
                rec["tac"], rec["ci"] = rest[0], rest[1]
            if len(rest) >= 3:
                rec["act"] = rest[2]
            if m.group(1) == "C5GREG" and len(rest) >= 5 and rest[4]:
                rec["nssai"] = rest[4]
            out["reg"].append(rec)
            continue
        m = re.match(r"^\+CESQ:\s*(.*)$", line)
        if m:
            v = _cesq(_split_args(m.group(1)))
            if v:
                v["ts"] = ts
                out["cesq"].append(v)
            continue
        m = re.match(r"^\+COPS:\s*(.*)$", line)
        if m:
            args = _split_args(m.group(1))
            if len(args) >= 3:
                out["cops"].append({"ts": ts, "format": args[1], "oper": args[2], "act": args[3] if len(args) > 3 else None})
            continue
        m = re.match(r"^\+CGCONTRDP:\s*(.*)$", line)
        if m:
            args = _split_args(m.group(1))
            if len(args) >= 4:
                rec = {"ts": ts, "cid": args[0], "apn": args[2], "addr": args[3]}
                if len(args) >= 6:
                    rec["dns"] = [x for x in args[5:7] if x and set(x) - set("0:. ")]
                out["pdp"].append(rec)
            continue
        m = re.match(r"^\+(CME|CMS) ERROR:\s*(.*)$", line)
        if m:
            out["errors"].append({"ts": ts, "text": line})
    return out


def _ipv6_compact(addr):
    """'2001:0db8:0000:0000:8000:...' -> '2001:db8::8000:...' (best effort)."""
    parts = addr.split(":")
    if len(parts) != 8:
        return addr
    parts = [p.lstrip("0") or "0" for p in parts]
    best, cur = (0, 0), (0, 0)
    for i, p in enumerate(parts + ["x"]):
        if p == "0":
            cur = (cur[0], cur[1] + 1) if cur[1] else (i, 1)
        else:
            if cur[1] > best[1]:
                best = cur
            cur = (0, 0)
    if best[1] >= 2:
        s, n = best
        return ":".join(parts[:s]) + "::" + ":".join(parts[s + n:])
    return ":".join(parts)


def _addr_text(addr):
    """+CGCONTRDP local address + mask: IPv4 'a.b.c.d.m.m.m.m' or IPv6 'x:x:..:x mask'."""
    a = addr.split(" ")[0]
    if a.count(".") == 7:
        a = ".".join(a.split(".")[:4])
    elif ":" in a:
        a = _ipv6_compact(a)
    return a


def _at_findings_context(at, n_messages):
    findings, ctx = [], {"network": [], "ue": [], "radio": [], "data": []}
    reg = at["reg"]
    denied = [r for r in reg if r["stat"] == "3"]
    if denied:
        r = denied[0]
        findings.append({"severity": "critical", "title": "The modem reported registration denied",
                         "detail": f"+{r['kind']} reported status 3 (registration denied) at {r.get('ts') or 'an unknown time'}.",
                         "causes": ["Subscription not allowed in this network or area", "PLMN or tracking area forbidden"],
                         "checks": ["Find the Registration Reject (or Attach Reject) cause in the messages",
                                    "Check the subscription profile in the HSS / UDM"],
                         "refs": [], "category": "network", "source": "AT", "confirms": True})
    if reg:
        final = {}
        for r in reg:
            final[r["kind"]] = r
        registered = any(r["stat"] in ("1", "5") for r in final.values())
        lost = [r for r in final.values() if r["stat"] in ("0", "4")]
        if lost and not registered and not denied:
            last = lost[-1]
            word = REG_STAT[last["stat"]][0]
            findings.append({"severity": "warning", "title": f"Not registered at the end of the log ({word})",
                             "detail": f"The last +{last['kind']} report, at {last.get('ts') or 'the end'}, was status {last['stat']}.",
                             "checks": ["Check radio coverage and whether the SIM and network are allowed"],
                             "refs": [], "category": "network", "source": "AT"})
        ok = [r for r in reg if r["stat"] in ("1", "5") and r.get("tac")]
        ok.sort(key=lambda r: r["kind"] == "C5GREG")  # prefer the 5GS report, keep time order
        if ok:
            r = ok[-1]
            ctx["network"].append({"label": "Registration (AT)", "value": REG_STAT[r["stat"]][0],
                                   "hint": ACT.get(r.get("act") or "", None)})
            ctx["network"].append({"label": "TAC (AT)", "value": r["tac"], "hint": f"{int(r['tac'], 16)} decimal" if re.fullmatch(r"[0-9A-Fa-f]+", r["tac"]) else None})
            ctx["network"].append({"label": "Cell ID (AT)", "value": r["ci"],
                                   "hint": _nci_hint(r["ci"]) if r["kind"] == "C5GREG" else None})
            if r.get("nssai"):
                ctx["data"].append({"label": "Allowed slices (AT)", "value": r["nssai"], "hint": _nssai_hint(r["nssai"])})
    names = [c for c in at["cops"] if c["format"] in ("0", "1") and c["oper"]]
    nums = [c for c in at["cops"] if c["format"] == "2" and c["oper"]]
    if names:
        c = names[-1]
        ctx["network"].insert(0, {"label": "Operator", "value": c["oper"], "hint": ACT.get(c.get("act") or "", None)})
    if nums:
        c = nums[-1]
        if len(c["oper"]) in (5, 6) and c["oper"].isdigit():
            txt = radio.plmn_text(c["oper"][:3], c["oper"][3:])
            ctx["network"].append({"label": "PLMN (AT)", "value": c["oper"], "hint": txt})
    for p in at["pdp"]:
        if p.get("apn"):
            ctx["data"].append({"label": "APN (AT)", "value": p["apn"], "hint": f"context {p['cid']}"})
        addr = _addr_text(p.get("addr") or "")
        if addr and not addr.startswith(("::", "0.0.0.0")):
            ctx["data"].append({"label": "IP address (AT)", "value": addr})
        for dns in p.get("dns") or []:
            ctx["data"].append({"label": "DNS server (AT)", "value": _addr_text(dns)})
    return findings, ctx


def _canon(label, value):
    """A comparable form of a context value, so AT and NAS reports of the same thing match."""
    base = label.replace(" (AT)", "").replace("Allowed slices", "Slices").replace("APN", "APN / DNN")         .replace("APN / DNN / DNN", "APN / DNN")
    v = str(value).strip().lower()
    if base in ("TAC", "Cell ID"):
        try:
            n = int(v, 16) if label.endswith("(AT)") else int(v)
            return base, str(n)
        except ValueError:
            pass
    if base in ("PLMN", "PLMN (AT)"):
        return "PLMN", re.sub(r"\D", "", v)
    return base, re.sub(r"[^0-9a-z]", "", v)


def merge_context(context, extra_ctx):
    """Add the capture's context rows, skipping what the messages already show."""
    for group, rows in extra_ctx.items():
        have = context.setdefault(group, [])
        seen = {_canon(r["label"], r["value"]) for r in have}
        seen_values = {(group, _canon(r["label"], r["value"])[1]) for r in have}
        for r in rows:
            key = _canon(r["label"], r["value"])
            if key in seen or (group, key[1]) in seen_values:
                continue
            seen.add(key)
            seen_values.add((group, key[1]))
            have.append({"label": r["label"], "value": r["value"], "hint": r.get("hint"), "from": None})


def _nci_hint(ci):
    if not re.fullmatch(r"[0-9A-Fa-f]{1,9}", ci or ""):
        return None
    v = int(ci, 16)
    return f"NR cell identity {v} (36-bit)"


def _nssai_hint(s):
    parts = []
    for item in s.split(":"):
        if not item:
            continue
        sst, _, sd = item.partition(".")
        try:
            name = {1: "eMBB", 2: "URLLC", 3: "MIoT", 4: "V2X"}.get(int(sst, 16))
        except ValueError:
            name = None
        parts.append(f"SST {sst}" + (f" ({name})" if name else "") + (f", SD {sd}" if sd else ""))
    return "; ".join(parts) or None


# --- radio from the modem traces --------------------------------------------------------

def _stats(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    return {"min": round(vals[0], 1), "max": round(vals[-1], 1), "avg": round(sum(vals) / len(vals), 1),
            "median": round(vals[len(vals) // 2], 1), "n": len(vals)}


def _radio(points, cesq):
    pts = [dict(p) for p in points or []]
    for c in cesq:
        pts.append({"ts": c.get("ts"), "rsrp": c.get("rsrp"), "rsrq": c.get("rsrq"), "sinr": c.get("sinr"), "src": "AT+CESQ"})
    pts = [p for p in pts if any(p.get(k) is not None for k in ("rsrp", "rsrq", "sinr"))]
    pts.sort(key=lambda p: p.get("ts") or "")
    if not pts:
        return None
    out = {"points": pts}
    for k in ("rsrp", "rsrq", "sinr"):
        s = _stats([p.get(k) for p in pts])
        if s:
            out[k] = s
    cells = sorted({(p.get("pci"), p.get("arfcn")) for p in pts if p.get("pci") is not None})
    if cells:
        out["cells"] = [{"pci": a, "arfcn": b, "band": _band(b)} for a, b in cells]
    return out


def _band(arfcn):
    info = radio.nrarfcn_info(arfcn) if arfcn is not None else None
    return info["bands"][0] if info and info.get("bands") else None


def _radio_findings(r):
    out = []
    if not r:
        return out
    rsrp, sinr = r.get("rsrp"), r.get("sinr")
    if rsrp and rsrp["median"] < -110:
        out.append({"severity": "warning", "title": "Weak coverage through the log",
                    "detail": f"Serving RSRP from the modem was {rsrp['median']} dBm (median), {rsrp['min']} to {rsrp['max']} dBm.",
                    "causes": ["Indoor or cell-edge location", "Antenna or line-of-sight problem"],
                    "checks": ["Compare with a reference device at the same spot", "Check the nearest site and its tilt"],
                    "refs": [], "category": "coverage", "source": "modem"})
    elif rsrp and rsrp["min"] < -115:
        out.append({"severity": "warning", "title": "Coverage dropped during the log",
                    "detail": f"Serving RSRP fell to {rsrp['min']} dBm (median {rsrp['median']} dBm).",
                    "refs": [], "category": "coverage", "source": "modem"})
    if sinr and sinr["median"] < 0:
        out.append({"severity": "warning", "title": "Poor signal quality (SINR)",
                    "detail": f"SINR from the modem was {sinr['median']} dB (median), {sinr['min']} to {sinr['max']} dB.",
                    "causes": ["Interference from a neighbour cell", "Overlapping coverage without a dominant cell"],
                    "checks": ["Look for a strong neighbour on the same frequency", "Check the interference level on the cell"],
                    "refs": [], "category": "interference", "source": "modem"})
    if rsrp and sinr and rsrp["median"] >= -110 and sinr["median"] >= 0:
        out.append({"severity": "ok", "title": "Radio conditions were fine",
                    "detail": f"Serving RSRP {rsrp['median']} dBm and SINR {sinr['median']} dB (medians from the modem).",
                    "refs": [], "category": "radio", "source": "modem"})
    return out


# --- IP capture -------------------------------------------------------------------------------

RCODE = {1: "format error", 2: "server failure", 3: "name does not exist", 4: "not implemented", 5: "refused"}


def _ip_findings(ip):
    out = []
    if not ip:
        return out
    dns = ip.get("dns") or []
    failed = [q for q in dns if q.get("rcode") not in (None, 0)]
    unanswered = [q for q in dns if q.get("answered") is False]
    if failed:
        names = sorted({q["name"] for q in failed})
        out.append({"severity": "warning", "title": f"DNS lookup failed for {names[0]}" + (f" and {len(names) - 1} more" if len(names) > 1 else ""),
                    "detail": "; ".join(f"{q['name']}: {RCODE.get(q['rcode'], 'error ' + str(q['rcode']))}" for q in failed[:4]) + ".",
                    "causes": ["Wrong or unreachable DNS server for this APN", "Domain blocked or not provisioned"],
                    "checks": ["Check the DNS servers given at PDU session setup", "Try the same lookup on another network"],
                    "refs": [], "category": "data", "source": "ip"})
    if unanswered:
        names = sorted({q["name"] for q in unanswered})
        out.append({"severity": "warning", "title": f"{len(unanswered)} DNS {'query' if len(unanswered) == 1 else 'queries'} got no answer",
                    "detail": "No response in the capture for: " + ", ".join(names[:5]) + ".",
                    "causes": ["DNS server unreachable over this PDU session", "Uplink data not getting through"],
                    "checks": ["Check the user plane (UPF) path and the DNS server address"],
                    "refs": [], "category": "data", "source": "ip"})
    if dns and not failed and not unanswered:
        out.append({"severity": "ok", "title": "DNS lookups answered",
                    "detail": f"{len(dns)} DNS {'lookup' if len(dns) == 1 else 'lookups'} in the IP capture, all answered.",
                    "refs": [], "category": "data", "source": "ip"})
    return out


def _stats_findings(stats):
    if not stats:
        return []
    lost = stats.get("lostCount") or 0
    if lost <= 0:
        return []
    pct = stats.get("lostPercent")
    return [{"severity": "warning", "title": "The log lost packets while recording",
             "detail": f"{lost} packets lost" + (f" ({pct}%)" if pct else "") + ". Messages may be missing, so a missing "
                       "answer may be a gap in the log rather than a network problem.",
             "checks": ["Record again with a faster USB port or fewer trace modules enabled"],
             "refs": [], "category": "log", "source": "log"}]


KIND_WORD = {"assert": "assert", "exception": "exception", "watchdog": "watchdog reset", "reset": "reset",
             "memory": "memory failure", "panic": "panic", "fatal": "fatal error"}

CRASH_CAUSES = {
    "assert": ["A software check inside the modem failed: an unexpected message, state or value reached code that does not handle it",
               "A modem firmware bug, often set off by a network configuration the firmware does not expect"],
    "exception": ["The modem processor hit an illegal memory access or instruction (a firmware bug or memory corruption)"],
    "watchdog": ["A modem task stopped responding (stuck in a loop, waiting on a lock or starved of CPU) and the watchdog reset it"],
    "memory": ["The modem ran out of memory or a buffer overflowed: a leak or a burst of traffic the firmware did not size for"],
    "panic": ["The modem's operating system stopped on an error it cannot recover from"],
    "reset": ["The modem restarted on its own: it crashed or was reset by the host"],
    "fatal": ["The modem reported an error it cannot recover from"],
}

CRASH_CHECKS = [
    "Send the assert record (.ass), the .logel and the modem build to UNISOC: they map the file and line to the cause",
    "Check whether the same assert repeats in other logs, and what the network sent just before it",
    "Try a newer modem build if the assert is known and fixed there",
]


def _before(ts, stamps):
    """Index of the last message logged at or before ts (same day, HH:MM:SS.mmm)."""
    if not ts or not stamps:
        return None
    t = ts[-12:] if re.search(r"\d{2}:\d{2}:\d{2}\.\d{3}$", ts) else ts
    best = None
    for i, s in stamps:
        if s and s <= t:
            best = i
    return best


def _crash_findings(crashes, stamps):
    """Every assert and crash, each its own critical finding, so none can be missed."""
    if not crashes:
        return []
    out = []
    events = crashes.get("events") or []
    groups = crashes.get("groups") or []
    covered = set()
    for e in events:
        if e.get("fromDump") and not e.get("where") and not e.get("expression") and e.get("kind") == "reset":
            out.append({"severity": "critical", "title": "The modem crashed: a memory dump was saved",
                        "detail": f"{e['file']} is written when the modem crashes (or when a dump is taken by hand). It holds "
                                  "no readable assert text; UNISOC's tools read the cause from it.",
                        "causes": CRASH_CAUSES["reset"], "checks": CRASH_CHECKS,
                        "refs": [], "category": "crash", "source": "assert"})
            continue
        bits = []
        if e.get("where"):
            bits.append(f"The modem stopped at {e['where']}" + (f" in {e['module']}" if e.get("module") else ""))
        elif e.get("module"):
            bits.append(f"The modem stopped in {e['module']}")
        if e.get("task"):
            bits.append(f"task {e['task']}")
        why = e.get("expression") or e.get("message")
        detail = ", ".join(bits) + (f": {why}" if why else "") + "." if bits or why else ""
        if e.get("exception") and e.get("kind") != "assert":
            detail += f" Exception: {e['exception']}."
        detail += f" Recorded in {e['file']}" + (f" at {e['ts']}" if e.get("ts") else "") + "."
        ref = _before(e.get("ts"), stamps)
        out.append({"severity": "critical", "title": e.get("title") or "Modem assert", "detail": detail.strip(),
                    "causes": CRASH_CAUSES.get(e.get("kind"), CRASH_CAUSES["assert"]), "checks": CRASH_CHECKS,
                    "refs": [ref] if ref is not None else [], "category": "crash", "source": "assert", "at": e.get("ts")})
        src = (e.get("source") or "").split("/")[-1].lower()
        for k, g in enumerate(groups):
            if (src and src in g["text"].lower()) or e["file"] in (g.get("files") or {}):
                covered.add(k)
    # strong lines no record explains: one finding per kind
    by_kind = {}
    for k, g in enumerate(groups):
        if g.get("strong") and k not in covered:
            by_kind.setdefault(g["kind"], []).append(g)
    for kind, gs in by_kind.items():
        n = sum(g["count"] for g in gs)
        first = min((g["first"] for g in gs if g.get("first")), default=None)
        files = sorted({f for g in gs for f in (g.get("files") or {})})
        sev = "critical" if kind in ("assert", "exception", "watchdog", "panic") else "warning"
        word = KIND_WORD.get(kind, kind)
        title = {"assert": "The modem asserted", "exception": "The modem crashed with an exception",
                 "watchdog": "The modem watchdog fired", "panic": "The modem panicked",
                 "reset": "The modem logged a reset", "memory": "The modem logged a memory failure",
                 "fatal": "The modem logged a fatal error"}.get(kind, f"Modem {word}")
        sample = gs[0]["text"]
        detail = (f"{n} {word} {'line' if n == 1 else 'lines'} in {', '.join(files[:3])}" + (f" and {len(files) - 3} more" if len(files) > 3 else "")
                  + (f", first at {first}" if first else "") + f". First one: “{sample[:220]}”")
        ref = _before(first, stamps)
        out.append({"severity": sev, "title": title, "detail": detail, "causes": CRASH_CAUSES.get(kind, []), "checks": CRASH_CHECKS,
                    "refs": [ref] if ref is not None else [], "category": "crash", "source": "assert", "count": n, "at": first})
    searched = crashes.get("searched") or []
    if searched and not out:
        weak = sum(g["count"] for g in groups)
        out.append({"severity": "ok", "title": "No assert or crash in any file",
                    "detail": f"{len(searched)} {'file was' if len(searched) == 1 else 'files were'} searched line by line for asserts, "
                              "crashes, exceptions, watchdog resets and memory failures; none was found."
                              + (f" {weak} trace {'line mentions' if weak == 1 else 'lines mention'} one in passing (see Asserts)." if weak else ""),
                    "refs": [], "category": "crash", "source": "assert"})
    return out


def extras_for(cap, n_messages, stamps=None):
    """Findings, context and radio series to fold into the session analysis.

    stamps: (message index, time) of each decoded message, to point a crash at what came just before it."""
    at = _parse_at(cap.get("at"))
    f_at, ctx = _at_findings_context(at, n_messages)
    r = _radio(cap.get("radio"), at["cesq"])
    findings = (_crash_findings(cap.get("crashes"), stamps) + f_at + _radio_findings(r) + _ip_findings(cap.get("ip"))
                + _stats_findings(cap.get("stats")))
    dev = cap.get("device") or {}
    ctx["device"] = [{"label": k, "value": v} for k, v in (
        ("Modem", dev.get("modem")), ("Platform", dev.get("platform")), ("Project", dev.get("project")),
        ("Hardware", dev.get("hw")),
        ("Modem build", dev.get("build")), ("Logel", dev.get("tool"))) if v]
    if r and r.get("cells"):
        for c in r["cells"]:
            txt = radio.nrarfcn_text(c["arfcn"]) if c.get("arfcn") is not None else None
            ctx["radio"].append({"label": "Serving cell (modem)", "value": f"PCI {c['pci']}" + (f", NR-ARFCN {c['arfcn']}" if c.get("arfcn") is not None else ""),
                                 "hint": txt})
    return {"findings": findings, "context": ctx, "radio": r}
