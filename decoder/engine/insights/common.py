"""Shared helpers for the analyzers."""

from .. import radio
from ..labels import humanize_cause_token

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2, "ok": 3}


# --- ASN.1 value navigation -------------------------------------------------

def dig(v, *keys):
    """Follow dict keys / CHOICE names. Returns None when the path is absent."""
    for k in keys:
        if isinstance(v, dict):
            v = v.get(k)
        elif isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], str):
            if v[0] == k:
                v = v[1]
            else:
                return None
        else:
            return None
        if v is None:
            return None
    return v


def find_all(v, key, depth=0, limit=40):
    """Yield every value stored under `key` (dict key or CHOICE alternative)."""
    if depth > limit:
        return
    if isinstance(v, dict):
        for k, x in v.items():
            if k == key:
                yield x
            yield from find_all(x, key, depth + 1, limit)
    elif isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], str):
        if v[0] == key:
            yield v[1]
        yield from find_all(v[1], key, depth + 1, limit)
    elif isinstance(v, list):
        for x in v:
            yield from find_all(x, key, depth + 1, limit)


def find_first(v, *keys):
    for key in keys:
        for x in find_all(v, key):
            return x
    return None


def has_key(v, key):
    for _ in find_all(v, key):
        return True
    return False


def choice(v):
    if isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], str):
        return v[0]
    return None


def bits(v):
    if isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], int):
        return v[0]
    return None


def plmn_str(p):
    """PLMN-Identity value {mcc:[..], mnc:[..]} -> (text, 'mcc-mnc')."""
    if not isinstance(p, dict) or p.get("mnc") is None:
        return None, None
    mcc = "".join(str(d) for d in p["mcc"]) if p.get("mcc") is not None else None
    mnc = "".join(str(d) for d in p["mnc"])
    return radio.plmn_text(mcc, mnc), f"{mcc or '?'}-{mnc}"


# --- NAS node navigation ----------------------------------------------------

def node_children(node):
    return node.get("c") or []


def nas_ie(tree, name):
    """Find an IE node by raw name at the message level (incl. inner message)."""
    if not tree:
        return None
    for c in node_children(tree):
        if c.get("k") == name:
            return c
    for c in node_children(tree):
        if c.get("tag") == "nas-message":
            hit = nas_ie(c, name)
            if hit:
                return hit
    return None


def nas_find(tree, name, depth=0):
    """Depth-first search for an IE node anywhere in the NAS tree."""
    if not tree or depth > 12:
        return None
    for c in node_children(tree):
        if c.get("k") == name:
            return c
        hit = nas_find(c, name, depth + 1)
        if hit:
            return hit
    return None


def node_int(node):
    if node is None:
        return None
    v = node.get("v")
    if v is not None:
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    for c in node_children(node):
        x = node_int(c)
        if x is not None:
            return x
    return None


def node_label(node):
    if node is None:
        return None
    if node.get("h"):
        return node["h"]
    for c in node_children(node):
        if c.get("h"):
            return c["h"]
    return node.get("v")


def child_val(node, name):
    if node is None:
        return None
    for c in node_children(node):
        if c.get("k") == name:
            return c
    return None


_T1 = {0: 2, 1: 60, 2: 360, 7: None}          # GPRS timer / timer 2 units (TS 24.008 10.5.7.3)
_T3 = {0: 600, 1: 3600, 2: 36000, 3: 2, 4: 30, 5: 60, 6: 1152000, 7: None}  # GPRS timer 3
TIMER3_IES = {"T3412Ext", "T3512", "T3324", "T3447", "T3448", "BackOffTimer", "LowerBoundTimer"}


def timer_seconds(node, ie_name):
    """Return (seconds or None, deactivated flag) for a GPRS timer IE node."""
    if node is None:
        return None, False
    unit = child_val(node, "Unit")
    value = child_val(node, "Value")
    if unit is None or value is None:
        return None, False
    try:
        u, v = int(unit["v"]), int(value["v"])
    except (TypeError, ValueError, KeyError):
        return None, False
    table = _T3 if ie_name in TIMER3_IES else _T1
    mult = table.get(u, 60)
    if mult is None:
        return None, True
    return mult * v, False


def fmt_seconds(s):
    if s is None:
        return "deactivated"
    if s == 0:
        return "0 s (stopped)"
    if s < 120:
        return f"{s} s"
    if s < 7200:
        m = s / 60
        return f"{m:g} min"
    h = s / 3600
    return f"{h:g} h"


# --- result builders -------------------------------------------------------

def hl(res, label, value, hint=None, tag=None, q=None):
    if value is None or value == "":
        return
    item = {"label": label, "value": str(value)}
    if hint:
        item["hint"] = hint
    if tag:
        item["tag"] = tag
    if q:
        item["q"] = q
    res["highlights"].append(item)


def finding(res, severity, title, detail=None, causes=None, checks=None, ref=None, code=None,
            category=None, field=None):
    f = {"severity": severity, "title": title}
    if detail:
        f["detail"] = detail
    if causes:
        f["causes"] = list(causes)
    if checks:
        f["checks"] = list(checks)
    if ref:
        f["ref"] = ref
    if code is not None:
        f["code"] = code
    if category:
        f["category"] = category
    if field:
        f["field"] = field
    res["findings"].append(f)
    return f


def cause_finding(res, kb_entry, kind, severity="critical", context=None, field=None):
    title = f"{kind} cause #{kb_entry['code']}: {kb_entry['name']}"
    detail = kb_entry["meaning"]
    if context:
        detail = f"{context} {detail}"
    return finding(res, severity, title, detail, kb_entry.get("causes"), kb_entry.get("checks"),
                   kb_entry.get("ref"), kb_entry["code"], kb_entry.get("category"), field)


_RAT_TYPES = {"eutra": "E-UTRA", "nr": "NR", "eutra-nr": "EN-DC (E-UTRA + NR)", "utra": "UTRA", "geran-cs": "GERAN CS",
              "geran-ps": "GERAN PS", "cdma2000-1XRTT": "CDMA2000 1xRTT", "utra-fdd": "UTRA FDD"}


def human(token):
    if token in _RAT_TYPES:
        return _RAT_TYPES[token]
    return humanize_cause_token(token)


def embedded_titles(res):
    """Titles of embedded messages; a NAS transport shows the message it carries."""
    out = []
    for e in res.get("embedded", []):
        r = e.get("result") or {}
        if r.get("ok"):
            t = r.get("message", {}).get("title")
            inner = (r.get("facts") or {}).get("inner") or []
            if t and inner and "Transport" in t:
                t = f"{t} ({inner[0]['title']})"
            out.append(t)
    return [t for t in out if t]


def embedded_results(res):
    return [e.get("result") for e in res.get("embedded", []) if (e.get("result") or {}).get("ok")]


def finalize(res):
    res["findings"].sort(key=lambda f: SEVERITY_ORDER.get(f["severity"], 9))
    worst = res["findings"][0]["severity"] if res["findings"] else None
    # bubble up findings of embedded messages (for example a reject inside a NAS container)
    for sub in embedded_results(res):
        for f in sub.get("findings", []):
            if f["severity"] in ("critical", "warning"):
                worst = f["severity"] if worst is None or SEVERITY_ORDER[f["severity"]] < SEVERITY_ORDER[worst] else worst
    res["status"] = {"critical": "failure", "warning": "warning"}.get(worst, "ok")
