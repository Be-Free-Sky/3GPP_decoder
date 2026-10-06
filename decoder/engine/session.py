"""Session level analysis across many decoded messages.

Builds: signalling ladder events, procedure tracking (start / success /
failure / no answer), correlated findings, radio trend, network & UE context,
KPIs and a root cause narrative.
"""

import re

from .labels import split_release
from .insights.common import SEVERITY_ORDER


# --- message keys ------------------------------------------------------------

def msg_key(res):
    if not res or not res.get("ok"):
        return None
    proto = res.get("protocol", {})
    fam = proto.get("family", "")
    name = (res.get("message") or {}).get("name") or ""
    if fam in ("LTE RRC", "NB-IoT RRC"):
        return "lte:" + split_release(name)[0]
    if fam == "NR RRC":
        return "nr:" + split_release(name)[0]
    if proto.get("layer") == "NAS":
        m = re.match(r"^(EMM|ESM|5GMM|5GSM|MM|GMM|SM|CC|RR)(.*)$", name)
        if m:
            return f"{m.group(1).lower()}:{m.group(2)}"
        return "nas:" + name
    return f"{proto.get('layer', '').lower()}:{name}"


# --- procedures -----------------------------------------------------------------

def _P(pid, name, start, success, failure=(), layer="RRC", progress=()):
    return {"id": pid, "name": name, "start": set(start), "success": set(success), "failure": set(failure),
            "layer": layer, "progress": set(progress)}


PROCEDURES = [
    _P("lte-rrc-setup", "RRC connection setup (LTE)", ["lte:rrcConnectionRequest"], ["lte:rrcConnectionSetupComplete"],
       ["lte:rrcConnectionReject"], progress=["lte:rrcConnectionSetup"]),
    _P("lte-rrc-reest", "RRC re-establishment (LTE)", ["lte:rrcConnectionReestablishmentRequest"],
       ["lte:rrcConnectionReestablishmentComplete"], ["lte:rrcConnectionReestablishmentReject"],
       progress=["lte:rrcConnectionReestablishment"]),
    _P("lte-rrc-resume", "RRC resume (LTE)", ["lte:rrcConnectionResumeRequest"], ["lte:rrcConnectionResumeComplete"],
       ["lte:rrcConnectionReject"]),
    _P("lte-as-sec", "AS security (LTE)", ["lte:securityModeCommand"], ["lte:securityModeComplete"], ["lte:securityModeFailure"]),
    _P("lte-cap", "UE capability transfer (LTE)", ["lte:ueCapabilityEnquiry"], ["lte:ueCapabilityInformation"]),
    _P("lte-reconf", "RRC reconfiguration (LTE)", ["lte:rrcConnectionReconfiguration"],
       ["lte:rrcConnectionReconfigurationComplete"], ["lte:rrcConnectionReestablishmentRequest"]),
    _P("nr-rrc-setup", "RRC setup (NR)", ["nr:rrcSetupRequest"], ["nr:rrcSetupComplete"], ["nr:rrcReject"], progress=["nr:rrcSetup"]),
    _P("nr-rrc-resume", "RRC resume (NR)", ["nr:rrcResumeRequest", "nr:rrcResumeRequest1"], ["nr:rrcResumeComplete"],
       ["nr:rrcReject"]),
    _P("nr-rrc-reest", "RRC re-establishment (NR)", ["nr:rrcReestablishmentRequest"], ["nr:rrcReestablishmentComplete"],
       ["nr:rrcSetup"], progress=["nr:rrcReestablishment"]),
    _P("nr-as-sec", "AS security (NR)", ["nr:securityModeCommand"], ["nr:securityModeComplete"], ["nr:securityModeFailure"]),
    _P("nr-cap", "UE capability transfer (NR)", ["nr:ueCapabilityEnquiry"], ["nr:ueCapabilityInformation"]),
    _P("nr-reconf", "RRC reconfiguration (NR)", ["nr:rrcReconfiguration"], ["nr:rrcReconfigurationComplete"],
       ["nr:rrcReestablishmentRequest"]),
    _P("eps-attach", "EPS attach", ["emm:AttachRequest"], ["emm:AttachComplete"], ["emm:AttachReject"], "NAS",
       progress=["emm:AttachAccept"]),
    _P("eps-tau", "Tracking area update", ["emm:TrackingAreaUpdateRequest"], ["emm:TrackingAreaUpdateAccept"],
       ["emm:TrackingAreaUpdateReject"], "NAS"),
    _P("eps-sr", "Service request (EPS)", ["emm:ServiceRequest", "emm:ExtServiceRequest"],
       ["emm:ServiceAccept", "lte:rrcConnectionReconfigurationComplete"], ["emm:ServiceReject"], "NAS"),
    _P("eps-auth", "Authentication (EPS AKA)", ["emm:AuthenticationRequest"], ["emm:AuthenticationResponse"],
       ["emm:AuthenticationFailure", "emm:AuthenticationReject"], "NAS"),
    _P("eps-smc", "NAS security mode (EPS)", ["emm:SecurityModeCommand"], ["emm:SecurityModeComplete"],
       ["emm:SecurityModeReject"], "NAS"),
    _P("eps-id", "Identity (EPS)", ["emm:IdentityRequest"], ["emm:IdentityResponse"], [], "NAS"),
    _P("eps-detach", "Detach (UE initiated)", ["emm:DetachRequestMO"], ["emm:DetachAccept"], [], "NAS"),
    _P("eps-pdn", "PDN connectivity", ["esm:PDNConnectivityRequest"], ["esm:ActDefaultEPSBearerCtxtAccept"],
       ["esm:PDNConnectivityReject", "esm:ActDefaultEPSBearerCtxtReject", "emm:AttachReject"], "NAS",
       progress=["esm:ActDefaultEPSBearerCtxtRequest"]),
    _P("eps-dedi", "Dedicated bearer", ["esm:ActDediEPSBearerCtxtRequest"], ["esm:ActDediEPSBearerCtxtAccept"],
       ["esm:ActDediEPSBearerCtxtReject"], "NAS"),
    _P("eps-esminfo", "ESM information", ["esm:InformationRequest"], ["esm:InformationResponse"], [], "NAS"),
    _P("5gs-reg", "5GS registration", ["5gmm:RegistrationRequest"], ["5gmm:RegistrationAccept"],
       ["5gmm:RegistrationReject"], "NAS"),
    _P("5gs-sr", "Service request (5GS)", ["5gmm:ServiceRequest"], ["5gmm:ServiceAccept"], ["5gmm:ServiceReject"], "NAS"),
    _P("5gs-auth", "Authentication (5G AKA)", ["5gmm:AuthenticationRequest"], ["5gmm:AuthenticationResponse"],
       ["5gmm:AuthenticationFailure", "5gmm:AuthenticationReject"], "NAS"),
    _P("5gs-smc", "NAS security mode (5GS)", ["5gmm:SecurityModeCommand"], ["5gmm:SecurityModeComplete"],
       ["5gmm:SecurityModeReject"], "NAS"),
    _P("5gs-id", "Identity (5GS)", ["5gmm:IdentityRequest"], ["5gmm:IdentityResponse"], [], "NAS"),
    _P("5gs-dereg", "De-registration (UE initiated)", ["5gmm:MODeregistrationRequest"], ["5gmm:MODeregistrationAccept"], [], "NAS"),
    _P("5gs-pdu", "PDU session establishment", ["5gsm:PDUSessionEstabRequest"], ["5gsm:PDUSessionEstabAccept"],
       ["5gsm:PDUSessionEstabReject"], "NAS"),
    _P("5gs-pdu-rel", "PDU session release (UE initiated)", ["5gsm:PDUSessionReleaseRequest"],
       ["5gsm:PDUSessionReleaseCommand"], ["5gsm:PDUSessionReleaseReject"], "NAS"),
]

NO_ANSWER_HINTS = {
    "lte-rrc-setup": ("No RRC Connection Setup after the request",
                      ["Random access problem: Msg3 not decoded or Msg4 (contention resolution) lost",
                       "UE uplink power too low at cell edge", "eNB overloaded and silently dropping"],
                      ["Check PRACH / Msg3 / Msg4 in lower layer logs (MAC)", "Check UE Tx power and RSRP"]),
    "nr-rrc-setup": ("No RRC Setup after the request",
                     ["NR random access problem (Msg3 / Msg4)", "Beam / SSB selection issue", "UL coverage limit on 3.5 GHz"],
                     ["Check NR MAC RACH logs", "Check SS-RSRP and selected SSB"]),
    "lte-reconf": ("Reconfiguration not confirmed", ["UE could not apply it", "Radio link lost during reconfiguration"],
                   ["Look for a re-establishment right after", "Compare with UE capability"]),
    "nr-reconf": ("Reconfiguration not confirmed", ["UE could not apply it", "Radio link lost"],
                  ["Look for a re-establishment right after"]),
    "eps-attach": ("Attach not completed", ["No response from the MME (S1 / core issue)", "UE gave up after T3410 (15 s)",
                                            "Radio dropped during the attach"], ["Check S1AP / MME logs for this UE", "Check radio before the drop"]),
    "5gs-reg": ("Registration not completed", ["No answer from the AMF", "UE timer T3510 expired (15 s)"],
                ["Check NGAP / AMF logs", "Check radio conditions"]),
    "eps-smc": ("NAS security mode not completed", ["Integrity check failure on the UE"], ["Check keys after authentication"]),
    "5gs-smc": ("NAS security mode not completed", ["Integrity check failure on the UE"], ["Check keys after authentication"]),
    "5gs-pdu": ("PDU session not established", ["SMF / UPF not answering", "Payload not forwarded by the AMF"],
                ["Check SMF logs and DL NAS Transport causes"]),
    "eps-pdn": ("PDN connection not established", ["PGW / SGW not answering", "APN problem"], ["Check S11 / S5 signalling"]),
}


def _ts_ms(ts):
    if not ts:
        return None
    m = re.match(r"(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?", ts)
    if not m:
        return None
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
    frac = m.group(4) or "0"
    ms = int((frac + "000")[:3])
    return ((h * 60 + mi) * 60 + s) * 1000 + ms


# --- lanes ---------------------------------------------------------------------------

RAN_SENDS = {
    "InitialUEMessage", "UplinkNASTransport", "UEContextReleaseRequest", "UEContextReleaseComplete",
    "InitialContextSetupResponse", "InitialContextSetupFailure", "E-RABSetupResponse", "E-RABModifyResponse",
    "E-RABReleaseResponse", "E-RABReleaseIndication", "HandoverRequired", "HandoverRequestAcknowledge",
    "HandoverFailure", "HandoverNotify", "PathSwitchRequest", "ENBStatusTransfer", "S1SetupRequest",
    "ENBConfigurationUpdate", "UECapabilityInfoIndication", "NASNonDeliveryIndication", "LocationReport",
    "ENBConfigurationTransfer", "UEContextModificationResponse", "UEContextModificationFailure",
    "PDUSessionResourceSetupResponse", "PDUSessionResourceReleaseResponse", "PDUSessionResourceModifyResponse",
    "PDUSessionResourceNotify", "PDUSessionResourceModifyIndication", "NGSetupRequest", "RANConfigurationUpdate",
    "UERadioCapabilityInfoIndication", "UplinkRANStatusTransfer", "RRCInactiveTransitionReport",
    "UplinkRANConfigurationTransfer", "UEContextResumeRequest", "UEContextSuspendRequest",
}


def _lanes_for(res, parent=None):
    """Return (from, to) lanes for a decoded message."""
    proto = res.get("protocol", {})
    fam = proto.get("family", "")
    layer = proto.get("layer")
    d = res.get("direction")
    if fam in ("LTE RRC", "NB-IoT RRC"):
        ran = "eNB"
    elif fam == "NR RRC":
        ran = "gNB"
    elif fam == "WCDMA RRC":
        ran = "RNC"
    else:
        ran = None
    if ran:
        return ("UE", ran) if d == "UL" else (ran, "UE")
    if layer == "NAS":
        nfam = (res.get("nas") or {}).get("family") or fam
        cn = "AMF" if nfam == "5GS NAS" else "MME" if nfam == "EPS NAS" else "MSC / SGSN"
        return ("UE", cn) if d != "DL" else (cn, "UE")
    if layer in ("S1AP", "NGAP"):
        ran, cn = ("eNB", "MME") if layer == "S1AP" else ("gNB", "AMF")
        name = (res.get("message") or {}).get("name")
        return (ran, cn) if name in RAN_SENDS else (cn, ran)
    if layer in ("X2AP", "XnAP"):
        return ("eNB" if layer == "X2AP" else "gNB", "Peer RAN")
    if layer == "F1AP":
        return ("gNB-DU", "gNB-CU")
    return ("UE", "Network")


LANE_ORDER = ["UE", "eNB", "gNB", "gNB-DU", "gNB-CU", "RNC", "Peer RAN", "MME", "AMF", "MSC / SGSN", "Network"]


# --- main ----------------------------------------------------------------------------

def analyze(items, extra=None):
    """items: list of {index, record, result}; returns the session report.

    extra: optional {findings, context, radio} from a modem capture (AT responses,
    modem traces, IP capture), folded into the same analysis."""
    events = []
    for it in items:
        res = it["result"]
        rec = it["record"]
        if not res.get("ok"):
            events.append({"i": it["index"], "ts": rec.get("timestamp"), "error": True,
                           "title": "Decode failed", "status": "failure"})
            continue
        frm, to = _lanes_for(res)
        events.append({"i": it["index"], "ts": rec.get("timestamp"), "from": frm, "to": to,
                       "title": res["message"]["title"], "layer": res["protocol"].get("family"),
                       "status": res.get("status", "ok"), "key": msg_key(res),
                       "bcast": res["protocol"].get("channel") in ("BCCH-BCH", "BCCH-DL-SCH", "PCCH", "MCCH")})
        for j, emb in enumerate(res.get("embedded", [])):
            sub = emb.get("result") or {}
            if not sub.get("ok") or sub["protocol"].get("layer") != "NAS":
                continue
            f2, t2 = _lanes_for(sub)
            events.append({"i": it["index"], "sub": j, "ts": rec.get("timestamp"), "from": f2, "to": t2,
                           "title": sub["message"]["title"], "layer": sub["protocol"].get("family"),
                           "status": sub.get("status", "ok"), "key": msg_key(sub), "via": res["message"]["title"]})
            # inner NAS (ESM in EMM, 5GSM in 5GMM transport)
            for inner in (sub.get("facts") or {}).get("inner", []):
                k = _inner_key(inner.get("cls"))
                if k:
                    events.append({"i": it["index"], "sub": j, "ts": rec.get("timestamp"), "from": f2, "to": t2,
                                   "title": inner["title"], "layer": sub["protocol"].get("family"),
                                   "status": "ok", "key": k, "via": sub["message"]["title"], "nested": True})
        if res["protocol"].get("layer") == "NAS":
            for inner in (res.get("facts") or {}).get("inner", []):
                k = _inner_key(inner.get("cls"))
                if k:
                    events.append({"i": it["index"], "ts": rec.get("timestamp"), "from": frm, "to": to,
                                   "title": inner["title"], "layer": res["protocol"].get("family"), "status": "ok",
                                   "key": k, "via": res["message"]["title"], "nested": True})

    procedures = _track(events)
    findings = _collect_findings(items)
    findings += _procedure_findings(procedures)
    findings += _pattern_findings(items, events)
    if extra:
        own_critical = any(f["severity"] == "critical" for f in findings)
        # AT status only confirms what the messages show; keep it when the messages say nothing
        findings += [dict(f) for f in extra.get("findings") or [] if not (f.get("confirms") and own_critical)]
    findings = _dedupe(findings)
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), f.get("refs", [0])[0] if f.get("refs") else 0))

    radio = _radio_series(items)
    context = _context(items)
    if extra:
        if extra.get("radio"):
            radio["modem"] = extra["radio"]
            if "rsrp" not in radio and extra["radio"].get("rsrp"):
                radio["rsrp"] = {k: extra["radio"]["rsrp"][k] for k in ("min", "max", "avg")}
        from .capture import merge_context
        merge_context(context, extra.get("context") or {})
    lanes = [l for l in LANE_ORDER if any(e.get("from") == l or e.get("to") == l for e in events)]
    kpis = _kpis(items, procedures, findings, events)
    narrative = _narrative(items, procedures, findings)
    verdict = "failure" if any(f["severity"] == "critical" for f in findings) else \
        "warning" if any(f["severity"] == "warning" for f in findings) else "ok"
    return {"events": [e for e in events if not e.get("nested")], "allEvents": events, "lanes": lanes,
            "procedures": procedures, "findings": findings, "radio": radio, "context": context, "kpis": kpis,
            "narrative": narrative, "verdict": verdict}


def _inner_key(cls):
    if not cls:
        return None
    m = re.match(r"^(EMM|ESM|5GMM|5GSM)(.*)$", cls)
    return f"{m.group(1).lower()}:{m.group(2)}" if m else None


def _track(events):
    open_ = []
    done = []
    for e in events:
        k = e.get("key")
        if not k:
            continue
        # close / progress
        for p in reversed(open_):
            d = p["_def"]
            if k in d["success"] or k in d["failure"]:
                if d["id"] in ("eps-sr",) and k == "lte:rrcConnectionReconfigurationComplete":
                    pass
                p["status"] = "success" if k in d["success"] else "failure"
                p["end"] = e["i"]
                p["endTs"] = e.get("ts")
                p["endTitle"] = e["title"]
                p["steps"].append(e["i"])
                open_.remove(p)
                done.append(p)
                break
            if k in d["progress"]:
                p["steps"].append(e["i"])
        for d in PROCEDURES:
            if k in d["start"]:
                prev = [p for p in open_ if p["_def"]["id"] == d["id"]]
                same = [p for p in prev if _same_attempt(p, e)]
                if same:
                    same[0]["steps"].append(e["i"])
                    continue
                for p in prev:
                    p["status"] = "retried"
                    open_.remove(p)
                    done.append(p)
                open_.append({"_def": d, "id": d["id"], "name": d["name"], "start": e["i"], "startTs": e.get("ts"),
                              "status": "open", "steps": [e["i"]], "layer": d["layer"]})
    for p in open_:
        p["status"] = "no-answer"
        done.append(p)
    out = []
    for p in sorted(done, key=lambda x: x["start"]):
        d = p.pop("_def")
        a, b = _ts_ms(p.get("startTs")), _ts_ms(p.get("endTs"))
        if a is not None and b is not None and b >= a:
            p["durationMs"] = b - a
        p["steps"] = sorted(set(p["steps"]))
        out.append(p)
    return out


def _same_attempt(p, e):
    """The same NAS message seen twice is one attempt, not a retry.

    It happens when a modem log carries a NAS message both as its own record and inside the RRC
    message that transports it, or repeats it in a NAS message container. NAS retry timers run
    for 10 s or more, so starts of a NAS procedure within 1.5 s belong together. RRC procedures
    are left alone: T300 retries can come sooner and must still count."""
    if p["layer"] != "NAS":
        return False
    if p["start"] == e["i"]:
        return True
    a, b = _ts_ms(p.get("startTs")), _ts_ms(e.get("ts"))
    return a is not None and b is not None and 0 <= b - a <= 1500


def _collect_findings(items):
    out = []
    for it in items:
        res = it["result"]
        if not res.get("ok"):
            out.append({"severity": "warning", "title": "Message could not be decoded",
                        "detail": res.get("error") or "Unknown error", "refs": [it["index"]], "category": "decode"})
            continue
        for f in res.get("findings", []):
            g = dict(f)
            g["refs"] = [it["index"]]
            out.append(g)
        for e in res.get("embedded", []):
            for f in (e.get("result") or {}).get("findings", []):
                g = dict(f)
                g["refs"] = [it["index"]]
                g["via"] = (e.get("result") or {}).get("message", {}).get("title")
                out.append(g)
    return out


def _procedure_findings(procs):
    out = []
    for p in procs:
        if p["status"] == "no-answer":
            hint = NO_ANSWER_HINTS.get(p["id"])
            if hint:
                out.append({"severity": "warning", "title": f"{p['name']}: {hint[0]}",
                            "detail": "The procedure started but the log has no completion or rejection after it. "
                                      "If the log ends right after the request, this may only be the capture window.",
                            "causes": hint[1], "checks": hint[2], "refs": [p["start"]], "category": "procedure"})
        elif p["status"] == "failure":
            out.append({"severity": "critical", "title": f"{p['name']} failed",
                        "detail": f"Ended with {p.get('endTitle')}.", "refs": [p["start"], p["end"]], "category": "procedure",
                        "procedure": True})
    # repeated attempts
    by = {}
    for p in procs:
        by.setdefault(p["id"], []).append(p)
    for pid, lst in by.items():
        if len(lst) >= 3 and pid in ("lte-rrc-setup", "nr-rrc-setup", "eps-attach", "5gs-reg", "eps-tau", "5gs-pdu", "eps-pdn",
                                     "lte-rrc-reest", "nr-rrc-reest"):
            out.append({"severity": "warning", "title": f"{lst[0]['name']} attempted {len(lst)} times",
                        "detail": "Repeated attempts point to a persistent problem rather than a one-off radio glitch.",
                        "refs": [p["start"] for p in lst][:8], "category": "procedure"})
    return out


def _pattern_findings(items, events):
    out = []
    ho_targets = []
    last_ho = None
    weak_before = None
    reest = 0
    for it in items:
        res = it["result"]
        if not res.get("ok"):
            continue
        facts = res.get("facts") or {}
        if facts.get("handover"):
            last_ho = (it["index"], facts["handover"])
            ho_targets.append((it["index"], facts["handover"].get("pci")))
        srv = facts.get("serving") or {}
        if "rsrp" in srv and srv["rsrp"] < -110:
            weak_before = (it["index"], srv["rsrp"])
        cause = facts.get("reestCause")
        if cause:
            reest += 1
            if cause == "handoverFailure" and last_ho:
                out.append({"severity": "critical", "title": f"Handover to PCI {last_ho[1].get('pci')} failed",
                            "detail": "A handover command was followed by re-establishment with handoverFailure: the UE could not "
                                      "access the target cell before T304 expired.",
                            "causes": ["Target cell weak or interfered at the moment of handover", "Wrong neighbour (PCI confusion)",
                                       "Target RACH problem"],
                            "checks": ["Check the target RSRP in the last measurement report", "Check for PCI confusion around the target",
                                       "Check target cell RACH statistics"],
                            "refs": [last_ho[0], it["index"]], "category": "mobility"})
            if cause == "otherFailure" and weak_before:
                out.append({"severity": "critical", "title": "Radio link failure in weak coverage",
                            "detail": f"Last reported serving RSRP was {weak_before[1]} dBm before the radio link failure.",
                            "causes": ["Coverage hole", "Missing or late handover to a better cell"],
                            "checks": ["Check neighbour relations and A3 / A5 thresholds at this location"],
                            "refs": [weak_before[0], it["index"]], "category": "coverage"})
            if cause == "reconfigurationFailure":
                prev = _prev_reconfig(items, it["index"])
                if prev is not None:
                    out.append({"severity": "critical", "title": "UE could not comply with a reconfiguration",
                                "detail": f"Message #{prev + 1} was rejected by the UE through re-establishment.",
                                "checks": ["Compare that reconfiguration against the UE capability"],
                                "refs": [prev, it["index"]], "category": "configuration"})
    # ping-pong: A, B, A target sequence
    for a, b, c in zip(ho_targets, ho_targets[1:], ho_targets[2:]):
        if a[1] is not None and a[1] == c[1] and a[1] != b[1]:
            out.append({"severity": "warning", "title": f"Ping-pong handover between PCI {a[1]} and PCI {b[1]}",
                        "detail": "The UE bounces between two cells. This wastes signalling and hurts throughput.",
                        "causes": ["Hysteresis / time-to-trigger too small", "Two cells with equal coverage (border)"],
                        "checks": ["Increase A3 hysteresis or TTT", "Review cell individual offsets"],
                        "refs": [a[0], b[0], c[0]], "category": "mobility"})
            break
    if reest >= 2:
        out.append({"severity": "warning", "title": f"{reest} re-establishments in this log",
                    "detail": "Frequent re-establishments mean unstable radio links in this area.",
                    "refs": [], "category": "radio"})
    return out


def _prev_reconfig(items, idx):
    for it in reversed(items):
        if it["index"] >= idx:
            continue
        k = msg_key(it["result"])
        if k in ("lte:rrcConnectionReconfiguration", "nr:rrcReconfiguration"):
            return it["index"]
    return None


def _dedupe(findings):
    seen = {}
    out = []
    for f in findings:
        key = (f["severity"], f["title"])
        if key in seen:
            seen[key]["refs"] = sorted(set(seen[key].get("refs", []) + f.get("refs", [])))
            seen[key]["count"] = seen[key].get("count", 1) + 1
            continue
        g = dict(f)
        seen[key] = g
        out.append(g)
    # A generic "<procedure> failed" adds nothing when a specific critical finding
    # already explains the message that ended the procedure.
    specific_refs = {r for f in out if f["severity"] == "critical" and not f.get("procedure") for r in f.get("refs", [])}
    return [f for f in out if not (f.get("procedure") and f.get("refs") and f["refs"][-1] in specific_refs)]


def _radio_series(items):
    pts = []
    for it in items:
        res = it["result"]
        if not res.get("ok"):
            continue
        facts = res.get("facts") or {}
        s = facts.get("serving")
        if s:
            pts.append({"i": it["index"], "ts": it["record"].get("timestamp"), "rat": facts.get("rat"),
                        "rsrp": s.get("rsrp"), "rsrq": s.get("rsrq"), "sinr": s.get("sinr"),
                        "neighbors": facts.get("neighbors", [])[:6]})
    if not pts:
        return {"points": []}
    rs = [p["rsrp"] for p in pts if p.get("rsrp") is not None]
    out = {"points": pts}
    if rs:
        out["rsrp"] = {"min": min(rs), "max": max(rs), "avg": round(sum(rs) / len(rs), 1)}
    return out


def _context(items):
    ctx = {"network": [], "ue": [], "radio": [], "data": []}
    seen = set()

    def add(group, label, value, hint=None):
        if value in (None, ""):
            return
        key = (group, label, str(value))
        if key in seen:
            return
        seen.add(key)
        ctx[group].append({"label": label, "value": str(value), "hint": hint, "from": cur["i"]})

    cur = {"i": 0}
    tag_map = {"plmn": ("network", "PLMN"), "tac": ("network", "TAC"), "cellid": ("network", "Cell ID"),
               "imsi": ("ue", "IMSI"), "guti": ("ue", "GUTI"), "tmsi": ("ue", "TMSI"), "imei": ("ue", "IMEI"),
               "suci": ("ue", "SUCI"), "band": ("radio", "Band"), "bandwidth": ("radio", "Bandwidth"),
               "apn": ("data", "APN / DNN"), "ip": ("data", "IP address"), "qos": ("data", "QoS"),
               "nssai": ("data", "Slices"), "endc": ("radio", "EN-DC")}

    def scan(res):
        for h in res.get("highlights", []):
            t = h.get("tag")
            if t in tag_map:
                g, lab = tag_map[t]
                add(g, lab, h["value"], h.get("hint"))
        facts = res.get("facts") or {}
        if facts.get("handover"):
            ho = facts["handover"]
            add("radio", "Handover target", f"PCI {ho.get('pci')}")
        if facts.get("imsVops") is not None:
            add("network", "IMS voice over PS", "supported" if facts["imsVops"] else "not supported")
        for e in res.get("embedded", []):
            if (e.get("result") or {}).get("ok"):
                scan(e["result"])

    for it in items:
        cur["i"] = it["index"]
        if it["result"].get("ok"):
            scan(it["result"])
    return ctx


def _kpis(items, procs, findings, events):
    ok = sum(1 for it in items if it["result"].get("ok"))
    rats = sorted({(it["result"].get("facts") or {}).get("rat") for it in items if it["result"].get("ok")} - {None})
    pstat = {"success": 0, "failure": 0, "no-answer": 0, "retried": 0}
    for p in procs:
        pstat[p["status"]] = pstat.get(p["status"], 0) + 1
    ts = [_ts_ms(it["record"].get("timestamp")) for it in items]
    ts = [t for t in ts if t is not None]
    return {
        "messages": len(items), "decoded": ok, "failedDecode": len(items) - ok,
        "critical": sum(1 for f in findings if f["severity"] == "critical"),
        "warnings": sum(1 for f in findings if f["severity"] == "warning"),
        "procedures": pstat, "rats": rats,
        "handovers": sum(1 for it in items if (it["result"].get("facts") or {}).get("handover")),
        "reestablishments": sum(1 for it in items if (it["result"].get("facts") or {}).get("reestCause")),
        "durationMs": (max(ts) - min(ts)) if len(ts) >= 2 else None,
    }


def _narrative(items, procs, findings):
    """Short chronological story of what happened, for the RCA summary."""
    lines = []
    for p in procs:
        if p["status"] == "success":
            lines.append({"i": p["start"], "severity": "ok", "text": f"{p['name']} completed"
                          + (f" in {p['durationMs']} ms" if p.get("durationMs") is not None else "")})
        elif p["status"] == "failure":
            lines.append({"i": p["start"], "severity": "critical", "text": f"{p['name']} failed ({p.get('endTitle')})"})
        elif p["status"] == "no-answer":
            lines.append({"i": p["start"], "severity": "warning", "text": f"{p['name']} started, no answer in the log"})
        elif p["status"] == "retried":
            lines.append({"i": p["start"], "severity": "warning", "text": f"{p['name']} restarted before finishing"})
    for f in findings:
        if f["severity"] == "critical" and not f.get("procedure") and f.get("refs"):
            lines.append({"i": f["refs"][-1], "severity": "critical", "text": f["title"]})
    lines.sort(key=lambda x: x["i"])
    root = None
    crit = [f for f in findings if f["severity"] == "critical"]
    if crit:
        # earliest failure wins; on a tie prefer correlated findings (more refs) over single-message ones
        # findings without a message (capture AT / trace facts) come after the ones tied to a message
        first = sorted(crit, key=lambda f: (f["refs"][0] if f.get("refs") else 10 ** 9, -len(f.get("refs", []))))[0]
        root = {"title": first["title"], "detail": first.get("detail"), "refs": first.get("refs", []),
                "checks": first.get("checks", []), "causes": first.get("causes", [])}
    return {"steps": lines[:40], "root": root}
