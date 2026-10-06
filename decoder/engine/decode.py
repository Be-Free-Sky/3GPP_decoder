"""Decode one message (bytes) as a given protocol, or detect the protocol.

Auto-detection is verified, not guessed: an ASN.1 candidate only counts when
re-encoding the decoded value reproduces the input bytes, and a NAS candidate
only counts when pycrate parses it without error and re-encodes it exactly.
"""

import contextlib
import io
import re

from . import catalog
from .asn1tree import Asn1Walker
from .nastree import NasWalker, message_info, EMM_DIR, ESM_DIR, FGMM_DIR, FGSM_DIR
from .labels import message_title, split_release, pretty

with contextlib.redirect_stdout(io.StringIO()):
    from pycrate_mobile import NAS
    from pycrate_mobile.NASLTE import parse_NASLTE_MO, parse_NASLTE_MT
    from pycrate_mobile.NAS5G import parse_NAS5G

SKELETON = {"message", "c1", "c2", "c3", "c4", "messageClassExtension", "criticalExtensions",
            "messageClassExtensionFuture-r13", "messageClassExtensionFuture-r15",
            "messageClassExtensionFuture-r16", "messageClassExtensionFuture-r17"}
MAX_NEST_DEPTH = 3


class DecodeError(Exception):
    pass


# ---------------------------------------------------------------------------
# low level decoders
# ---------------------------------------------------------------------------

def _asn1_decode(proto, data):
    obj = catalog.asn1_obj(proto)
    obj.reset_val()
    if proto["codec"] == "aper":
        obj.from_aper(data)
    else:
        obj.from_uper(data)
    return obj, obj._val


def _asn1_reencode(proto, obj):
    if proto["codec"] == "aper":
        return obj.to_aper()
    return obj.to_uper()


def _nas_direction_from_bytes(data):
    """Best guess of NAS direction from the message type (None when ambiguous)."""
    if len(data) < 2:
        return None
    b0 = data[0]
    if b0 == 0x7E and len(data) >= 3:
        shdr = data[1] & 0x0F
        if shdr in (1, 2, 3, 4) and len(data) >= 10:
            if shdr in (1, 3) and data[7] in (0x7E, 0x2E):
                return _nas_direction_from_bytes(data[7:])
            return None
        return FGMM_DIR.get(data[2])
    if b0 == 0x2E and len(data) >= 4:
        return FGSM_DIR.get(data[3])
    pd = b0 & 0x0F
    shdr = b0 >> 4
    if pd == 7:
        if shdr == 12:
            return "UL"
        if shdr in (1, 2, 3, 4):
            if shdr in (1, 3) and len(data) > 7:
                return _nas_direction_from_bytes(data[6:])
            return None
        return EMM_DIR.get(data[1])
    if pd == 2 and len(data) >= 3:
        return ESM_DIR.get(data[2])
    return None


def _nas_parse(kind, data, direction):
    """Return (msg, err, direction_used, note)."""
    note = None
    if kind == "nas.5gs":
        msg, err = parse_NAS5G(data, inner=True)
        if msg is not None and err == 0:
            info = message_info(msg)
            if info.get("sec") in (2, 4):
                msg2, err2 = parse_NAS5G(data, inner=True, null_cipher=True)
                if msg2 is not None and _has_inner_message(msg2):
                    msg, note = msg2, "ciphered-but-plain"
        return msg, err, direction or _nas_direction_from_bytes(data), note
    if kind == "nas.eps":
        d = direction or _nas_direction_from_bytes(data)
        order = [parse_NASLTE_MT, parse_NASLTE_MO] if d == "DL" else [parse_NASLTE_MO, parse_NASLTE_MT]
        # ESM messages never carry a security header: the high nibble is the EPS bearer identity
        esm = bool(data) and (data[0] & 0x0F) == 2
        best = (None, 111, d, None)
        for fn in order:
            msg, err = fn(data, inner=True, sec_hdr=not esm)
            if msg is not None and err == 0:
                info = message_info(msg)
                if info.get("sec") in (2, 4):
                    msg2, _err2 = fn(data, inner=True, null_cipher=True)
                    if msg2 is not None and _has_inner_message(msg2):
                        msg, note = msg2, "ciphered-but-plain"
                return msg, 0, d, note
            if best[0] is None:
                best = (msg, err, d, None)
        return best
    # 2G / 3G NAS
    d = direction
    fns = [NAS.parse_NAS_MT, NAS.parse_NAS_MO] if d == "DL" else [NAS.parse_NAS_MO, NAS.parse_NAS_MT]
    for fn in fns:
        msg, err = fn(data)
        if msg is not None and err == 0:
            return msg, 0, d, None
    msg, err = fns[0](data)
    return msg, err, d, None


_PLAIN_HEADERS = ("EMMHeader", "ESMHeader", "5GMMHeader", "5GSMHeader")


def _has_inner_message(msg):
    """True when the payload of a security protected message parsed as a plain NAS message."""
    try:
        inner = msg[3]
    except Exception:
        return False
    if inner.CLASS != "Envelope" or inner._name == "NASMessage":
        return False
    for c in inner:
        return c._name in _PLAIN_HEADERS
    return False


def nas_quality(msg, data):
    """Detection score for a parsed NAS message (how well the bytes are verified)."""
    info = message_info(msg)
    try:
        same_len = len(msg.to_bytes()) == len(data)
    except Exception:
        same_len = False
    sec = info.get("sec")
    if sec in (None, 12):
        return 92 if same_len else 70
    if _has_inner_message(msg):
        # integrity protected (or deciphered) payload that parses as plain NAS
        return 90 if sec in (1, 3) else 78
    # ciphered payload: only the 6-byte header can be checked
    return 50


# ---------------------------------------------------------------------------
# message identity
# ---------------------------------------------------------------------------

def asn1_message_name(proto, val):
    """Find the message choice name inside a decoded *-Message value."""
    if proto["codec"] == "aper":
        if isinstance(val, tuple) and len(val) == 2:
            outcome, body = val
            inner = body.get("value") if isinstance(body, dict) else None
            if isinstance(inner, tuple):
                return inner[0], outcome
            return outcome, outcome
        return proto["channel"], None
    v = val
    if isinstance(v, dict) and "message" in v:
        v = v["message"]
        if isinstance(v, dict):
            # BCCH-BCH in LTE: message is the MIB itself
            return "masterInformationBlock", None
    guard = 0
    while isinstance(v, tuple) and len(v) == 2 and guard < 8:
        name, inner = v
        if name not in SKELETON:
            return name, None
        v = inner
        guard += 1
    return proto["channel"], None


def _sib_list(val):
    """For System Information messages, list the SIB types carried."""
    found = []

    def rec(x, depth=0):
        if depth > 8:
            return
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ("sib-TypeAndInfo", "sib-TypeAndInfo-r8") and isinstance(v, list):
                    for item in v:
                        if isinstance(item, tuple):
                            found.append(item[0])
                else:
                    rec(v, depth + 1)
        elif isinstance(x, tuple) and len(x) == 2:
            rec(x[1], depth + 1)
    rec(val)
    out = []
    for s in found:
        m = re.match(r"sib(\d+)", s)
        out.append(f"SIB{m.group(1)}" if m else pretty(s))
    return out


# ---------------------------------------------------------------------------
# nested containers
# ---------------------------------------------------------------------------

def _nest_target(proto, name, tname, parent):
    fam = proto["family"]
    if tname == "DedicatedInfoNAS" or name == "dedicatedInfoNAS":
        return "nas.eps"
    if tname == "DedicatedNAS-Message" or name == "dedicatedNAS-Message":
        return "nas.5gs"
    if tname == "NAS-PDU":
        return "nas.5gs" if fam in ("NGAP", "XnAP", "F1AP") else "nas.eps"
    if name == "ue-CapabilityRAT-Container" and isinstance(parent, dict):
        rat = parent.get("rat-Type")
        return {"eutra": "lte-rrc.ue-eutra-capability", "nr": "nr-rrc.ue-nr-capability",
                "eutra-nr": "nr-rrc.ue-mrdc-capability"}.get(rat)
    if name == "nr-SecondaryCellGroupConfig-r15":
        return "nr-rrc.rrc-reconfiguration"
    if name in ("nr-RadioBearerConfig1-r15", "nr-RadioBearerConfig2-r15"):
        return "nr-rrc.radio-bearer-config"
    if name == "scg-ConfigResponseNR-r15":
        return "nr-rrc.rrc-reconfiguration-complete"
    if name == "measResultSCG-r15":
        return "nr-rrc.meas-result-scg-failure"
    if name == "eutra-SCG":
        return "lte-rrc.rrc-connection-reconfiguration"
    if name == "targetRAT-MessageContainer" and isinstance(parent, dict):
        rat = parent.get("targetRAT-Type")
        if fam == "LTE RRC" and rat in ("nr-r15", "nr"):
            return "nr-rrc.rrc-reconfiguration"
        if fam == "NR RRC" and rat == "eutra":
            return "lte-rrc.dl-dcch"
    return None


# ---------------------------------------------------------------------------
# public decode
# ---------------------------------------------------------------------------

def decode_as(pid, data, direction=None, depth=0):
    """Decode bytes as protocol `pid`. Returns a result dict (never raises)."""
    from . import insights  # local import to avoid a cycle

    proto = catalog.BY_ID.get(pid)
    if proto is None:
        return _error_result(pid, data, f"Unknown protocol '{pid}'")
    res = {
        "ok": False, "protocol": _proto_public(proto), "bytes": len(data), "hex": data.hex().upper(),
        "warnings": [], "findings": [], "highlights": [], "embedded": [],
        "direction": direction or proto.get("direction"),
    }
    try:
        if proto["codec"] in ("uper", "aper"):
            _decode_asn1_into(res, proto, data, depth)
        else:
            _decode_nas_into(res, proto, data, direction, depth)
    except DecodeError as e:
        res["ok"] = False
        res["error"] = str(e)
        return res
    except catalog.ModuleUnavailable:
        raise
    except Exception as e:  # pycrate raises many exception types on bad input
        res["ok"] = False
        res["error"] = _clean_err(e)
        return res
    try:
        insights.analyze(res, proto)
    except Exception as e:  # analysis must never hide a successful decode
        res["warnings"].append(f"Analysis step failed: {_clean_err(e)}")
    return res


def _decode_asn1_into(res, proto, data, depth):
    with contextlib.redirect_stdout(io.StringIO()):
        obj, val = _asn1_decode(proto, data)
        text = obj.to_asn1()
        try:
            re_enc = _asn1_reencode(proto, obj)
        except Exception:
            re_enc = None
    if re_enc is not None and re_enc != data:
        if data.startswith(re_enc) and not any(data[len(re_enc):]):
            res["warnings"].append(f"{len(data) - len(re_enc)} trailing zero byte(s) after the message (padding).")
        elif len(re_enc) != len(data):
            res["warnings"].append("Re-encoding does not reproduce the input exactly; check that the channel is correct.")
    name, outcome = asn1_message_name(proto, val)
    title = message_title(name)
    if proto["codec"] == "uper" and name in ("systemInformation", "systemInformation-r8"):
        sibs = _sib_list(val)
        if sibs:
            title = f"System Information ({', '.join(sibs)})"
    if outcome:
        title = f"{pretty(name)}"
        res["outcome"] = outcome
    res["message"] = {"name": name, "title": title, "release": split_release(name)[1]}

    nested_results = res["embedded"]

    def hook(field, tname, buf, parent):
        if depth >= MAX_NEST_DEPTH or not buf:
            return None
        target = _nest_target(proto, field, tname, parent)
        if target is None:
            return None
        d = res.get("direction")
        if target.startswith("nas."):
            d = _ap_nas_direction(proto, name) or d
        sub = decode_as(target, buf, direction=d if target.startswith("nas.") else None, depth=depth + 1)
        nested_results.append({"field": field, "result": sub})
        return len(nested_results) - 1

    obj = catalog.asn1_obj(proto)
    walker = Asn1Walker(catalog.module_name(proto), nest_hook=hook)
    tree = walker.walk_root(obj, val, obj._name)
    # Show the message itself as the root, not the *-Message wrapper
    tree = _unwrap_root(tree, name)
    res["tree"] = tree
    res["text"] = text
    res["ok"] = True
    res["_val"] = val


def _ap_nas_direction(proto, procedure):
    if proto["layer"] not in ("S1AP", "NGAP"):
        return None
    p = (procedure or "").lower()
    if "uplink" in p or "initialue" in p:
        return "UL"
    if "downlink" in p or "initialcontext" in p or "erabsetup" in p or "pdusessionresource" in p:
        return "DL"
    return None


def _unwrap_root(tree, name):
    node = tree
    for _ in range(4):
        kids = node.get("c")
        if node.get("k") == name or not kids or len(kids) != 1:
            break
        if kids[0].get("c") is None:
            break
        node = kids[0]
    return node


def _decode_nas_into(res, proto, data, direction, depth):
    with contextlib.redirect_stdout(io.StringIO()):
        msg, err, used_dir, note = _nas_parse(proto["id"], data, direction)
    if msg is None:
        raise DecodeError(f"Not a valid {proto['family']} message (pycrate error {err}: {_NAS_ERR.get(err, 'decode error')}).")
    if err:
        res["warnings"].append(f"Partial decode, NAS error {err} ({_NAS_ERR.get(err, 'decode error')}).")
    info = message_info(msg)
    walker = NasWalker()
    tree = walker.walk(msg)
    try:
        text = msg.show()
    except Exception:
        text = ""
    try:
        if len(msg.to_bytes()) != len(data):
            res["warnings"].append("Re-encoding does not reproduce the input length; the message may be truncated or carry extra bytes.")
    except Exception:
        pass
    inner_info = None
    if info.get("sec") not in (None, 12):
        # security protected: the readable message is the first inner one
        for inner in walker.nested:
            ii = message_info(inner)
            if ii.get("type") is not None:
                inner_info = ii
                break
    if info.get("sec") is not None and info.get("sec") != 12:
        res["security"] = {"header": info["sec"], "label": info.get("secLabel")}
        if info["sec"] in (2, 4) and note != "ciphered-but-plain":
            res["warnings"].append("NAS payload is ciphered. The inner message cannot be read without the NAS keys.")
        if note == "ciphered-but-plain":
            res["warnings"].append("Security header says ciphered, yet the payload parses as plain NAS. "
                                   "Modem logs (Logel) usually record NAS after deciphering, so the decode below is shown as plain text.")
    shown = inner_info or info
    tree["l"] = info.get("title") if info.get("sec") in (None, 12) else "Security Protected NAS Message"
    res["message"] = {"name": shown.get("cls"), "title": shown.get("title"), "proto": shown.get("proto"),
                      "type": shown.get("type")}
    if inner_info and info.get("sec") is not None:
        res["message"]["wrapped"] = True
    res["nas"] = {"family": shown.get("family"), "proto": shown.get("proto")}
    res["direction"] = direction or shown.get("direction") or used_dir
    res["tree"] = tree
    res["text"] = text
    res["ok"] = True
    res["_msg"] = msg
    res["_nested_nas"] = walker.nested


_NAS_ERR = {96: "invalid mandatory information", 97: "message type non-existent or not implemented",
            111: "protocol error, unspecified", 95: "semantically incorrect message"}


def _proto_public(proto):
    return {k: proto[k] for k in ("id", "family", "rat", "layer", "channel", "label")}


def _error_result(pid, data, msg):
    return {"ok": False, "error": msg, "protocol": {"id": pid}, "bytes": len(data), "hex": data.hex().upper(),
            "warnings": [], "findings": [], "highlights": [], "embedded": []}


def _clean_err(e):
    s = str(e) or e.__class__.__name__
    s = re.sub(r"\s+", " ", s)
    return s[:300]


# ---------------------------------------------------------------------------
# detection
# ---------------------------------------------------------------------------

_CHANNEL_PRIOR = {"UL-DCCH": 10, "DL-DCCH": 10, "UL-CCCH": 8, "DL-CCCH": 8, "BCCH-DL-SCH": 6,
                  "PCCH": 3, "BCCH-BCH": 0, "UL-CCCH1": 2, "MCCH": 0}


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def detect(data, hints=None):
    """Return candidates [(score, pid, message_name)] sorted best first."""
    hints = hints or {}
    cands = []
    # --- NAS first: strongly structured
    b0 = data[0] if data else None
    if b0 is not None:
        nas_kinds = []
        pd, shdr = b0 & 0x0F, b0 >> 4
        if b0 in (0x7E, 0x2E):
            nas_kinds.append("nas.5gs")
        elif (pd == 7 and shdr in (0, 1, 2, 3, 4, 12)) or pd == 2:
            nas_kinds.append("nas.eps")
        elif pd in (3, 5, 6, 8, 9, 0x0A, 0x0B):
            nas_kinds.append("nas.2g3g")
        for kind in nas_kinds:
            with contextlib.redirect_stdout(io.StringIO()):
                try:
                    msg, err, _d, _n = _nas_parse(kind, data, hints.get("direction"))
                except Exception:
                    msg, err = None, 111
            if msg is not None and err == 0:
                if kind == "nas.eps" and (data[0] & 0x0F) == 2 and 1 <= (data[0] >> 4) <= 4:
                    continue  # EPS bearer identities 1-4 are reserved: not a real ESM message
                info = message_info(msg)
                score = nas_quality(msg, data)
                if kind == "nas.2g3g":
                    score -= 15
                cands.append((score, kind, info.get("title") or ""))
    # --- ASN.1 channels (RRC first; AP interfaces when hinted or nothing else fits)
    _try_asn1(data, cands, "uper")
    if hints.get("ap") or not any(c[0] >= 60 for c in cands):
        _try_asn1(data, cands, "aper")
    return _rank(cands, hints)


def _try_asn1(data, cands, codec):
    for proto in catalog.PROTOCOLS:
        if not proto["auto"] or proto["codec"] != codec:
            continue
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                obj, val = _asn1_decode(proto, data)
                enc = _asn1_reencode(proto, obj)
        except catalog.ModuleUnavailable:
            raise
        except Exception:
            continue
        if enc == data:
            score = 60
        elif data.startswith(enc) and not any(data[len(enc):]):
            score = 48
        else:
            continue
        name, _ = asn1_message_name(proto, val)
        if name.startswith("spare") or name in ("messageClassExtension", "criticalExtensionsFuture") \
                or "Future" in name or name.startswith("_ext"):
            score -= 30
        if _contains_future(val):
            score -= 12
        score += _CHANNEL_PRIOR.get(proto["channel"], 0)
        if proto["channel"] == "BCCH-BCH" and len(data) != 3:
            score -= 25
        cands.append((score, proto["id"], name))


def _rank(cands, hints):
    out = []
    for score, pid, name in cands:
        proto = catalog.BY_ID[pid]
        s = score
        if hints.get("protocol") == pid:
            s += 40
        if hints.get("family") and hints["family"] == proto["family"]:
            s += 15
        if hints.get("rat") and hints["rat"] == proto["rat"]:
            s += 8
        if hints.get("channel") and hints["channel"] == proto["channel"]:
            s += 12
        if hints.get("direction") and proto.get("direction") and hints["direction"] != proto["direction"]:
            s -= 10
        if hints.get("text") and name and len(_norm(name)) > 5 and _norm(split_release(name)[0]) in hints["text"]:
            s += 25
        if hints.get("ratPrior") and hints["ratPrior"] == proto["rat"]:
            s += 6
        out.append((s, pid, name))
    out.sort(key=lambda x: -x[0])
    return out


def _contains_future(val, depth=0):
    if depth > 6:
        return False
    if isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], str):
        if val[0] == "criticalExtensionsFuture" or val[0].startswith("_ext"):
            return True
        return _contains_future(val[1], depth + 1)
    if isinstance(val, dict):
        return any(_contains_future(v, depth + 1) for v in list(val.values())[:4])
    return False


def confidence_for(cands):
    if not cands:
        return "none"
    best = cands[0][0]
    second = cands[1][0] if len(cands) > 1 else -100
    if best >= 85 and best - second >= 15:
        return "high"
    if best >= 60 and best - second >= 8:
        return "medium"
    return "low"
