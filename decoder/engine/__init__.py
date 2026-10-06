"""Skyworth 3GPP Decoder engine.

decode_text(text, protocol="auto", split="auto") -> JSON-ready report.
decode_capture(capture) -> the same report for a modem log capture (see capture.py).
"""

from collections import Counter

from . import catalog
from .decode import decode_as, detect, confidence_for, _error_result
from .hexinput import parse_records, hints_from_header
from . import session as session_mod
from . import capture as capture_mod

VERSION = "1.0.0"
MAX_RECORDS = 3000
MAX_BYTES = 65536


def get_catalog():
    return {"protocols": catalog.public_catalog(), "groups": catalog.GROUPS, "version": VERSION}


def _strip_private(res):
    if not isinstance(res, dict):
        return res
    for k in [k for k in res if k.startswith("_")]:
        del res[k]
    for e in res.get("embedded", []):
        _strip_private(e.get("result"))
    return res


def _decode_record(rec, protocol, rat_prior=None):
    data = rec["bytes"]
    hints = hints_from_header(rec.get("header"))
    if rat_prior and "rat" not in hints:
        hints["ratPrior"] = rat_prior
    if len(data) > MAX_BYTES:
        return _error_result(protocol, data[:16], f"Message is {len(data)} bytes; the limit is {MAX_BYTES}."), None
    if protocol and protocol != "auto":
        res = decode_as(protocol, data, direction=hints.get("direction"))
        res["detection"] = {"mode": "manual", "confidence": "manual", "alternatives": []}
        return res, hints
    # Fast path: the log header names the protocol / channel. Trust it when the bytes
    # decode cleanly under it, which avoids trying every channel.
    hinted = hints.get("protocol")
    if hinted in catalog.BY_ID:
        res = decode_as(hinted, data, direction=hints.get("direction") if hinted.startswith("nas.") else None)
        if res.get("ok") and not any("Re-encoding" in w for w in res.get("warnings", [])):
            res["detection"] = {"mode": "hint", "confidence": "high", "alternatives": []}
            return res, hints
    cands = detect(data, hints)
    if not cands:
        res = _error_result("auto", data, "Could not identify this message. Pick the protocol and channel manually "
                                          "(for example LTE RRC UL-DCCH or 5GS NAS).")
        res["detection"] = {"mode": "auto", "confidence": "none", "alternatives": []}
        return res, hints
    best = cands[0]
    res = decode_as(best[1], data, direction=hints.get("direction") if best[1].startswith("nas.") else None)
    alts = []
    seen = {best[1]}
    for score, pid, name in cands[1:]:
        if pid in seen:
            continue
        seen.add(pid)
        alts.append({"id": pid, "label": catalog.BY_ID[pid]["label"], "message": name, "score": score})
        if len(alts) >= 5:
            break
    res["detection"] = {"mode": "hint" if hints.get("protocol") or hints.get("channel") else "auto",
                        "confidence": confidence_for(cands), "score": best[0], "alternatives": alts}
    return res, hints


def decode_text(text, protocol="auto", split="auto", overrides=None):
    """overrides: {message index: protocol id} to force the protocol of single messages."""
    records = parse_records(text or "", split=split)
    truncated = len(records) > MAX_RECORDS
    records = records[:MAX_RECORDS]
    overrides = {int(k): v for k, v in (overrides or {}).items()}
    items = []
    for i, rec in enumerate(records):
        res, hints = _decode_record(rec, overrides.get(i, protocol))
        items.append({"index": i, "record": rec, "result": res, "hints": hints})
    # second pass: resolve ambiguous auto detections using the dominant RAT of the log
    if protocol in (None, "auto") and len(items) > 1:
        rats = Counter(it["result"]["protocol"].get("rat") for it in items
                       if it["result"].get("ok") and it["result"].get("detection", {}).get("confidence") == "high")
        if rats:
            dom = rats.most_common(1)[0][0]
            for it in items:
                det = it["result"].get("detection", {})
                if it["index"] in overrides:
                    continue
                if det.get("confidence") in ("low", "medium") and it["result"]["protocol"].get("rat") != dom:
                    res, _ = _decode_record(it["record"], protocol, rat_prior=dom)
                    if res.get("ok"):
                        it["result"] = res
    report = {"version": VERSION, "truncated": truncated, "messages": []}
    sess = session_mod.analyze(items) if items else None
    for it in items:
        rec = it["record"]
        report["messages"].append({
            "index": it["index"], "line": rec.get("line"), "timestamp": rec.get("timestamp"),
            "header": rec.get("header"), "result": _strip_private(it["result"]),
        })
    report["session"] = sess
    return report


def decode_capture(cap):
    """A modem log capture: PDUs with their logged channel, plus AT, radio, IP and log facts."""
    recs = (cap.get("records") or [])[:capture_mod.MAX_RECORDS]
    truncated = len(cap.get("records") or []) > capture_mod.MAX_RECORDS
    items = []
    for i, r in enumerate(recs):
        try:
            data = bytes.fromhex(r.get("hex") or "")
        except ValueError:
            data = b""
        header = r.get("header")
        rec = {"bytes": data, "header": header, "line": None, "timestamp": r.get("ts")}
        res = capture_mod.decode_record(r.get("protocol"), data,
                                        lambda d, h=header: _decode_record({"bytes": d, "header": h}, "auto")[0])
        items.append({"index": i, "record": rec, "result": res, "hints": {}})
    extra = capture_mod.extras_for(cap, len(items))
    report = {"version": VERSION, "truncated": truncated, "messages": []}
    for it in items:
        rec = it["record"]
        report["messages"].append({"index": it["index"], "line": None, "timestamp": rec.get("timestamp"),
                                   "header": rec.get("header"), "result": _strip_private(it["result"])})
    report["session"] = session_mod.analyze(items, extra) if items else None
    report["capture"] = {k: cap.get(k) for k in ("name", "kind", "files", "device", "ip", "stats", "notes", "span") if cap.get(k) is not None}
    if not items:
        report["capture"]["extra"] = extra
    return report
