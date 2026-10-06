"""NAS analysis: EPS (TS 24.301) and 5GS (TS 24.501)."""

from .. import causes
from .common import (nas_ie, nas_find, node_int, node_label, node_children, child_val, timer_seconds,
                     fmt_seconds, hl, finding, cause_finding)

QCI_TEXT = {1: "QCI 1 (conversational voice, VoLTE)", 2: "QCI 2 (conversational video)", 3: "QCI 3 (real-time gaming)",
            4: "QCI 4 (buffered video)", 5: "QCI 5 (IMS signalling)", 6: "QCI 6 (TCP default, priority)",
            7: "QCI 7 (voice / video / interactive)", 8: "QCI 8 (TCP default)", 9: "QCI 9 (TCP default, best effort)",
            65: "QCI 65 (MC push-to-talk voice)", 69: "QCI 69 (MC signalling)", 70: "QCI 70 (MC data)"}


TRANSPORTS = {"5GMMULNASTransport", "5GMMDLNASTransport", "EMMULNASTransport", "EMMDLNASTransport"}


def analyze(res, proto):
    tree = res.get("tree")
    msg = res.get("message", {})
    name = msg.get("name") or ""
    facts = res["facts"]
    facts["nas"] = msg.get("proto")
    facts["rat"] = "NR" if (res.get("nas") or {}).get("family") == "5GS NAS" else "LTE"
    inner_nodes = _inner_messages(res, tree, facts)
    fn = HANDLERS.get(name)
    if fn:
        fn(res, tree, facts)
    else:
        _generic(res, tree, facts)
    if name in TRANSPORTS:
        for node in inner_nodes:
            _analyze_inner(res, node, facts)
    if res.get("security") and res["security"]["header"] in (2, 4) and not msg.get("wrapped"):
        res["summary"] = (f"Security protected and ciphered {res['nas']['family'] if res.get('nas') else 'NAS'} message. "
                          "The content is encrypted; decode the deciphered NAS from the modem log instead.")
    if not res.get("summary"):
        res["summary"] = f"{msg.get('title')} ({(res.get('nas') or {}).get('proto', 'NAS')})."


def _inner_messages(res, tree, facts):
    inner, nodes = [], []

    def rec(n, depth=0):
        if depth > 10:
            return
        for c in node_children(n):
            if c.get("tag") == "nas-message" and c.get("v"):
                inner.append({"title": c["v"], "cls": c.get("t")})
                nodes.append(c)
            rec(c, depth + 1)
    rec(tree)
    if res.get("message", {}).get("wrapped") and inner:
        inner, nodes = inner[1:], nodes[1:]
    facts["inner"] = inner
    for i in inner:
        hl(res, "Embedded message", i["title"], tag="nas")
    return nodes


def _analyze_inner(res, node, facts):
    """Run the handler of a message carried in a NAS transport and merge its results."""
    cls = node.get("t")
    fn = HANDLERS.get(cls)
    if fn is None:
        return
    sub = {"highlights": [], "findings": [], "message": {"title": node.get("v"), "name": cls}, "facts": {}}
    fn(sub, node, sub["facts"])
    have = {(h["label"], h["value"]) for h in res["highlights"]}
    res["highlights"].extend(h for h in sub["highlights"] if (h["label"], h["value"]) not in have)
    res["findings"].extend(sub["findings"])
    for k in ("cause", "dnn", "ip"):
        if k in sub["facts"]:
            facts[k] = sub["facts"][k]
    if sub.get("summary"):
        extra = f", DNN {facts['dnn']}" if facts.get("dnn") and "DNN" not in sub["summary"] else ""
        res["summary"] = f"{sub['summary'].rstrip('.')} (carried in {res['message']['title']}{extra})."


def _text(node):
    """Readable value of an IE: its own label, or its children's labels (Value first)."""
    if not node:
        return None
    if node.get("h"):
        return node["h"]
    kids = node_children(node)
    if not kids:
        return node.get("v")
    labs = []
    for c in sorted(kids, key=lambda c: 0 if c.get("k") in ("Value", "V") else 1):
        if c.get("k") in ("spare", "T", "L"):
            continue
        if c.get("h"):
            labs.append(c["h"])
    return ", ".join(labs) if labs else node_label(node)


def _cause(res, tree, kind, ie_name, severity="critical", context=None):
    node = nas_ie(tree, ie_name) or nas_find(tree, ie_name)
    code = node_int(node)
    if code is None:
        return None
    kb = causes.lookup(kind, code)
    hl(res, f"{kind} cause", f"#{code}", kb["name"], "cause")
    cause_finding(res, kb, kind, severity, context, field=ie_name)
    res["facts"]["cause"] = {"kind": kind, "code": code, "name": kb["name"]}
    return kb


def _timer(res, tree, ie, label):
    node = nas_ie(tree, ie) or nas_find(tree, ie)
    if node is None:
        return None
    if node.get("num") is not None:
        secs = node["num"]
        hl(res, label, node.get("h"), tag="timer")
        return None if secs < 0 else secs
    secs, off = timer_seconds(node, ie)
    if secs is None and not off:
        return None
    hl(res, label, fmt_seconds(None if off else secs), tag="timer")
    return secs


def _algos(node, prefixes):
    """List the capability bits set to 1 in a UE (network / security) capability node."""
    out = []
    for c in node_children(node):
        k = c.get("k", "")
        if any(k.startswith(p) for p in prefixes) and c.get("v") == "1":
            out.append(k.replace("_128", "").replace("_", "-"))
    return out


# --- EPS EMM -------------------------------------------------------------------

def attach_request(res, tree, f):
    at = _text(nas_ie(tree, "EPSAttachType"))
    ident = nas_ie(tree, "EPSID")
    hl(res, "Attach type", at)
    hl(res, "Identity", ident.get("h") if ident else None, tag=ident.get("tag") if ident else None)
    cap = nas_ie(tree, "UENetCap")
    if cap:
        hl(res, "Ciphering supported", ", ".join(_algos(cap, ("EEA",))))
        hl(res, "Integrity supported", ", ".join(_algos(cap, ("EIA",))))
    vdp = nas_ie(tree, "VoiceDomPref")
    hl(res, "Voice domain preference", _text(vdp))
    inner = [i["title"] for i in f.get("inner", [])]
    who = ident.get("h") if ident else "its identity"
    res["summary"] = f"UE requests {at or 'EPS attach'} using {who}" + (f", together with {inner[0]}." if inner else ".")


def attach_accept(res, tree, f):
    result = _text(nas_ie(tree, "EPSAttachResult"))
    hl(res, "Attach result", result)
    _timer(res, tree, "T3412", "T3412 periodic TAU")
    _timer(res, tree, "T3412Ext", "T3412 extended")
    _timer(res, tree, "T3402", "T3402")
    guti = nas_ie(tree, "GUTI")
    hl(res, "Assigned GUTI", guti.get("h") if guti else None, tag="guti")
    tai = nas_ie(tree, "TAIList")
    hl(res, "TAI list", _text(tai))
    _net_feat(res, tree, "EPSNetFeat")
    kb = None
    cause = nas_ie(tree, "EMMCause")
    if cause is not None:
        kb = _cause(res, tree, "EMM", "EMMCause", "warning", "Attach accepted for EPS only.")
    _esm_bearer(res, tree, f)
    s = f"Network accepts the attach ({result or 'EPS only'})"
    if guti and guti.get("h"):
        s += " and assigns a new GUTI"
    if f.get("apn"):
        s += f". Default bearer on APN {f['apn']}"
        if f.get("ip"):
            s += f" with IP {f['ip']}"
    res["summary"] = s + "."


def _net_feat(res, tree, ie):
    node = nas_ie(tree, ie)
    if not node:
        return
    vops = None
    for c in node_children(node):
        if c.get("k") in ("IMS_VoPS", "IMSVoPS", "IMS-VoPS", "IMS_VoPS_3GPP", "IMSVoPS3GPP"):
            vops = c.get("v")
    if vops is not None:
        hl(res, "IMS voice over PS", "supported" if vops == "1" else "not supported",
           "VoLTE / VoNR possible" if vops == "1" else "Voice will use CS fallback or EPS fallback")
        res["facts"]["imsVops"] = vops == "1"


def _esm_bearer(res, tree, f):
    apn = nas_find(tree, "APN")
    if apn is not None:
        txt = apn.get("h") or _text(apn)
        if txt:
            txt = txt.strip('"')
            f["apn"] = txt
            hl(res, "APN", txt, tag="apn")
    addr = nas_find(tree, "PDNAddr")
    if addr is not None:
        ip = addr.get("h")
        if ip:
            f["ip"] = ip
            hl(res, "PDN address", ip, tag="ip")
    qos = nas_find(tree, "EPSQoS")
    if qos is not None:
        qci = node_int(child_val(qos, "QCI") or qos)
        if qci is not None:
            hl(res, "QoS", QCI_TEXT.get(qci, f"QCI {qci}"), tag="qos")
            f["qci"] = qci
    ambr = nas_find(tree, "APN_AMBR")
    if ambr is not None and ambr.get("h"):
        hl(res, "APN-AMBR", ambr["h"])


def attach_reject(res, tree, f):
    kb = _cause(res, tree, "EMM", "EMMCause")
    _timer(res, tree, "T3346", "T3346 back-off")
    _timer(res, tree, "T3402", "T3402")
    esm = nas_find(tree, "ESMCause")
    if esm is not None:
        _cause(res, tree, "ESM", "ESMCause", "critical", "Embedded ESM reject:")
    res["summary"] = f"Network rejects the attach: {kb['name'] if kb else 'cause not given'}."


def attach_complete(res, tree, f):
    res["summary"] = "UE confirms the attach and accepts the default EPS bearer. Attach procedure complete."


def detach_mo(res, tree, f):
    dt = _text(nas_ie(tree, "EPSDetachType"))
    hl(res, "Detach type", dt)
    res["summary"] = f"UE detaches from the network ({dt or 'type n/a'})."


def detach_mt(res, tree, f):
    dt = _text(nas_ie(tree, "EPSDetachType"))
    hl(res, "Detach type", dt)
    kb = None
    if nas_ie(tree, "EMMCause"):
        kb = _cause(res, tree, "EMM", "EMMCause", "warning", "Network initiated detach.")
    res["summary"] = f"Network detaches the UE ({dt or 'type n/a'})" + (f": {kb['name']}." if kb else ".")
    if dt and "re-attach required" in dt.lower() and not kb:
        finding(res, "info", "Network asks the UE to re-attach", "Usually after a core change or subscription update.", category="network")


def tau_request(res, tree, f):
    ut = _text(nas_ie(tree, "EPSUpdateType"))
    hl(res, "Update type", ut)
    g = nas_ie(tree, "OldGUTI")
    hl(res, "Old GUTI", g.get("h") if g else None, tag="guti")
    res["summary"] = f"UE requests a tracking area update ({ut or 'type n/a'})."


def tau_accept(res, tree, f):
    hl(res, "Update result", _text(nas_ie(tree, "EPSUpdateResult")))
    _timer(res, tree, "T3412", "T3412 periodic TAU")
    g = nas_ie(tree, "GUTI")
    hl(res, "New GUTI", g.get("h") if g else None, tag="guti")
    _net_feat(res, tree, "EPSNetFeat")
    if nas_ie(tree, "EMMCause"):
        _cause(res, tree, "EMM", "EMMCause", "warning", "TAU accepted for EPS only.")
    res["summary"] = "Network accepts the tracking area update."


def tau_reject(res, tree, f):
    kb = _cause(res, tree, "EMM", "EMMCause")
    _timer(res, tree, "T3346", "T3346 back-off")
    res["summary"] = f"Network rejects the tracking area update: {kb['name'] if kb else 'cause n/a'}."


def service_request(res, tree, f):
    res["summary"] = "UE asks to re-establish its EPS bearers (idle to connected for data or signalling)."


def ext_service_request(res, tree, f):
    st = _text(nas_ie(tree, "ServiceType"))
    hl(res, "Service type", st)
    csfb = st and "fallback" in st.lower()
    res["summary"] = f"UE sends an extended service request ({st or 'type n/a'})."
    if csfb:
        finding(res, "info", "CS fallback started", "The UE is leaving LTE for a CS voice call (no VoLTE for this call).",
                checks=["Expect RRC release with redirect or Mobility From EUTRA Command", "If VoLTE was expected, check IMS registration"],
                category="voice")


def service_reject(res, tree, f):
    kb = _cause(res, tree, "EMM", "EMMCause")
    _timer(res, tree, "T3442", "T3442")
    _timer(res, tree, "T3346", "T3346 back-off")
    res["summary"] = f"Network rejects the service request: {kb['name'] if kb else 'cause n/a'}."


def service_accept(res, tree, f):
    res["summary"] = "Network accepts the service request."


def auth_request(res, tree, f):
    hl(res, "NAS KSI", _text(nas_ie(tree, "NAS_KSI")))
    rand = nas_ie(tree, "RAND")
    hl(res, "RAND", rand.get("v") if rand else None)
    res["summary"] = "Network challenges the UE (EPS AKA): the SIM must verify AUTN and answer with RES."


def auth_response(res, tree, f):
    res["summary"] = "UE answers the authentication challenge with RES. Network verifies it against XRES."


def auth_failure(kind):
    def h(res, tree, f):
        kb = _cause(res, tree, kind, f"{'EMM' if kind == 'EMM' else '5GMM'}Cause",
                    "warning" if node_int(nas_ie(tree, f"{'EMM' if kind == 'EMM' else '5GMM'}Cause")) == 21 else "critical",
                    "UE rejected the network authentication.")
        if nas_ie(tree, "AUTS"):
            hl(res, "AUTS", "present", "Resynchronisation token for the HSS / UDM")
        res["summary"] = f"UE rejects the authentication challenge: {kb['name'] if kb else 'cause n/a'}."
    return h


def auth_reject(kind):
    def h(res, tree, f):
        res["summary"] = "Network rejects authentication. The UE marks the SIM invalid until it is power cycled."
        finding(res, "critical", "Authentication rejected", "The network could not verify the RES from the SIM.",
                ["K / OPc on the SIM do not match the HSS / UDM", "SIM not provisioned for this network", "Wrong IMSI to K mapping"],
                ["Check subscriber keys in HSS / UDM", "Check the SIM profile used for the test"],
                "TS 24.301 5.4.2.5" if kind == "EMM" else "TS 24.501 5.4.1.3.5", category="security")
    return h


def identity_request(ie):
    def h(res, tree, f):
        t = _text(nas_ie(tree, ie))
        hl(res, "Identity requested", t)
        res["summary"] = f"Network asks the UE for its {t or 'identity'}."
        if t and ("IMSI" in t or "SUCI" in t):
            finding(res, "info", "Network asks for the permanent identity",
                    "The network could not resolve the temporary identity (GUTI) the UE used.",
                    ["Old MME / AMF unreachable", "Context lost after a core restart"], category="network")
    return h


def identity_response(ie):
    def h(res, tree, f):
        node = nas_ie(tree, ie)
        hl(res, "Identity", node.get("h") if node else None, tag=node.get("tag") if node else None)
        res["summary"] = f"UE answers with {(node or {}).get('h') or 'its identity'}."
    return h


def smc(kind):
    def h(res, tree, f):
        alg = nas_ie(tree, "NASSecAlgo")
        cip = integ = None
        for c in node_children(alg or {}):
            if c.get("k") == "CiphAlgo":
                cip = c.get("h") or c.get("v")
            elif c.get("k") == "IntegAlgo":
                integ = c.get("h") or c.get("v")
        hl(res, "NAS ciphering", cip)
        hl(res, "NAS integrity", integ)
        if nas_ie(tree, "IMEISVReq"):
            hl(res, "IMEISV requested", _text(nas_ie(tree, "IMEISVReq")))
        res["summary"] = f"Network starts NAS security: {cip or 'ciphering n/a'}, {integ or 'integrity n/a'}."
        if cip and ("0" in str(cip).split()[0] or "null" in str(cip).lower()):
            finding(res, "warning", "NAS ciphering is null", "NAS messages will not be encrypted.",
                    checks=["Expected only for emergency or lab networks"], category="security")
    return h


def smc_reject(kind):
    def h(res, tree, f):
        kb = _cause(res, tree, kind, "EMMCause" if kind == "EMM" else "5GMMCause")
        res["summary"] = f"UE rejects NAS security mode: {kb['name'] if kb else 'cause n/a'}."
    return h


def emm_status(res, tree, f):
    kb = _cause(res, tree, "EMM", "EMMCause", "warning", "EMM status reports a protocol error.")
    res["summary"] = f"EMM status: {kb['name'] if kb else 'cause n/a'}."


def emm_information(res, tree, f):
    full = nas_ie(tree, "NetFullName")
    short = nas_ie(tree, "NetShortName")
    hl(res, "Network name", _text(full) or _text(short))
    tz = nas_ie(tree, "LocalTimeZone")
    hl(res, "Time zone", _text(tz))
    t = nas_ie(tree, "UnivTimeAndTimeZone")
    hl(res, "Network time", _text(t))
    res["summary"] = "Network sends its name and time information."


def nas_transport(res, tree, f):
    res["summary"] = f"{res['message']['title']}: transparent NAS container (for example SMS over SGs)."


def cs_service_notification(res, tree, f):
    res["summary"] = "Network pages the UE for a CS service (incoming call or SMS via CS fallback)."
    finding(res, "info", "CS fallback paging", "A mobile terminated CS call is arriving; the UE will leave LTE.", category="voice")


# --- EPS ESM -------------------------------------------------------------------

def pdn_conn_request(res, tree, f):
    pt = _text(nas_ie(tree, "PDNType"))
    rt = _text(nas_ie(tree, "RequestType"))
    hl(res, "PDN type", pt)
    hl(res, "Request type", rt)
    _esm_bearer(res, tree, f)
    res["summary"] = f"UE requests a PDN connection ({pt or 'type n/a'})" + (f" to APN {f['apn']}." if f.get("apn") else ".")


def esm_reject(res, tree, f):
    kb = _cause(res, tree, "ESM", "ESMCause")
    _timer(res, tree, "BackOffTimer", "Back-off timer")
    res["summary"] = f"{res['message']['title']}: {kb['name'] if kb else 'cause n/a'}."


def act_default_bearer(res, tree, f):
    _esm_bearer(res, tree, f)
    if nas_ie(tree, "ESMCause"):
        _cause(res, tree, "ESM", "ESMCause", "info", "Bearer activated with a restriction.")
    res["summary"] = "Network activates the default EPS bearer" + (f" on APN {f['apn']}" if f.get("apn") else "") + \
        (f" with IP {f['ip']}" if f.get("ip") else "") + "."


def act_dedicated_bearer(res, tree, f):
    _esm_bearer(res, tree, f)
    hl(res, "Linked EPS bearer", _text(nas_ie(tree, "LinkedEPSBearerId")))
    q = f.get("qci")
    res["summary"] = "Network activates a dedicated bearer" + (f" ({QCI_TEXT.get(q, f'QCI {q}')})" if q else "") + "."
    if q == 1:
        finding(res, "info", "VoLTE voice bearer set up", "QCI 1 dedicated bearer: a VoLTE call is being established.", category="voice")


def deact_bearer(res, tree, f):
    node = nas_ie(tree, "ESMCause")
    code = node_int(node)
    sev = "info" if code in (36, None) else "warning"
    kb = _cause(res, tree, "ESM", "ESMCause", sev, "Bearer deactivation.")
    res["summary"] = f"Network deactivates an EPS bearer ({kb['name'] if kb else 'cause n/a'})."


def esm_info_response(res, tree, f):
    _esm_bearer(res, tree, f)
    res["summary"] = "UE provides ESM information" + (f" (APN {f['apn']})." if f.get("apn") else ".")


def esm_status(res, tree, f):
    kb = _cause(res, tree, "ESM", "ESMCause", "warning")
    res["summary"] = f"ESM status: {kb['name'] if kb else 'cause n/a'}."


# --- 5GMM ------------------------------------------------------------------------

def reg_request(res, tree, f):
    rt = _text(nas_ie(tree, "5GSRegType"))
    ident = nas_ie(tree, "5GSID")
    hl(res, "Registration type", rt)
    hl(res, "Identity", ident.get("h") if ident else None, tag=ident.get("tag") if ident else None)
    nssai = nas_ie(tree, "NSSAI")
    hl(res, "Requested NSSAI", _text(nssai), tag="nssai")
    cap = nas_ie(tree, "UESecCap")
    if cap:
        hl(res, "5G ciphering supported", ", ".join(_algos(cap, ("5G-EA", "5GEA", "EA"))))
    tai = nas_ie(tree, "TAI")
    hl(res, "Last visited TAI", _text(tai))
    res["summary"] = f"UE requests 5GS registration ({rt or 'type n/a'}) using {ident.get('h') if ident and ident.get('h') else 'its identity'}."


def reg_accept(res, tree, f):
    hl(res, "Registration result", _text(nas_ie(tree, "5GSRegResult")))
    g = nas_ie(tree, "GUTI")
    hl(res, "Assigned 5G-GUTI", g.get("h") if g else None, tag="guti")
    hl(res, "Allowed NSSAI", _text(nas_ie(tree, "AllowedNSSAI")), tag="nssai")
    rej = nas_ie(tree, "RejectedNSSAI")
    if rej is not None:
        hl(res, "Rejected NSSAI", _text(rej) or "present", tag="nssai")
        finding(res, "warning", "Some requested slices were rejected",
                "Registration succeeded, but part of the requested NSSAI is not available in this PLMN / TA.",
                ["Slice not subscribed", "Slice not supported in this tracking area"],
                ["Compare Requested NSSAI with Allowed NSSAI and subscription"], category="config", field="RejectedNSSAI")
    _timer(res, tree, "T3512", "T3512 periodic registration")
    _timer(res, tree, "T3502", "T3502")
    _net_feat(res, tree, "5GSNetFeat")
    res["summary"] = "Network accepts the 5GS registration" + (" and assigns a new 5G-GUTI." if g and g.get("h") else ".")


def reg_reject(res, tree, f):
    kb = _cause(res, tree, "5GMM", "5GMMCause")
    _timer(res, tree, "T3346", "T3346 back-off")
    _timer(res, tree, "T3502", "T3502")
    rej = nas_ie(tree, "RejectedNSSAI")
    hl(res, "Rejected NSSAI", _text(rej) if rej else None, tag="nssai")
    res["summary"] = f"Network rejects the 5GS registration: {kb['name'] if kb else 'cause n/a'}."


def reg_complete(res, tree, f):
    res["summary"] = "UE confirms the registration (acknowledges the new 5G-GUTI / configuration)."


def dereg_mo(res, tree, f):
    dt = _text(nas_ie(tree, "DeregistrationType"))
    hl(res, "De-registration type", dt)
    res["summary"] = f"UE de-registers ({dt or 'type n/a'})."


def dereg_mt(res, tree, f):
    dt = _text(nas_ie(tree, "DeregistrationType"))
    hl(res, "De-registration type", dt)
    kb = None
    if nas_ie(tree, "5GMMCause"):
        kb = _cause(res, tree, "5GMM", "5GMMCause", "warning", "Network initiated de-registration.")
    _timer(res, tree, "T3346", "T3346 back-off")
    res["summary"] = f"Network de-registers the UE ({dt or 'type n/a'})" + (f": {kb['name']}." if kb else ".")


def fg_service_request(res, tree, f):
    st = _text(nas_ie(tree, "ServiceType"))
    hl(res, "Service type", st)
    ident = nas_ie(tree, "5GSID")
    hl(res, "Identity", ident.get("h") if ident else None, tag="tmsi")
    res["summary"] = f"UE requests service ({st or 'type n/a'})."


def fg_service_reject(res, tree, f):
    kb = _cause(res, tree, "5GMM", "5GMMCause")
    _timer(res, tree, "T3346", "T3346 back-off")
    res["summary"] = f"Network rejects the service request: {kb['name'] if kb else 'cause n/a'}."


def fg_service_accept(res, tree, f):
    res["summary"] = "Network accepts the service request."


def fg_auth_request(res, tree, f):
    hl(res, "ngKSI", _text(nas_ie(tree, "NAS_KSI")))
    hl(res, "ABBA", _text(nas_ie(tree, "ABBA")))
    res["summary"] = "Network challenges the UE (5G AKA / EAP-AKA'). The SIM must verify AUTN and answer with RES*."


def fg_auth_response(res, tree, f):
    res["summary"] = "UE answers the 5G authentication challenge with RES*."


def fg_auth_result(res, tree, f):
    res["summary"] = "Network sends the EAP authentication result."


def config_update(res, tree, f):
    g = nas_ie(tree, "GUTI")
    hl(res, "New 5G-GUTI", g.get("h") if g else None, tag="guti")
    hl(res, "Network name", _text(nas_ie(tree, "NetFullName")) or _text(nas_ie(tree, "NetShortName")))
    hl(res, "Allowed NSSAI", _text(nas_ie(tree, "AllowedNSSAI")), tag="nssai")
    hl(res, "Time zone", _text(nas_ie(tree, "LocalTimeZone")))
    res["summary"] = "Network updates the UE configuration (identity, slices, network name or time)."


def ul_nas_transport(res, tree, f):
    pct = _text(nas_ie(tree, "PayloadContainerType"))
    hl(res, "Payload", pct)
    hl(res, "PDU session ID", _text(nas_ie(tree, "PDUSessID")))
    hl(res, "Request type", _text(nas_ie(tree, "RequestType")))
    dnn = nas_ie(tree, "DNN")
    if dnn is not None:
        t = (dnn.get("h") or _text(dnn) or "").strip('"')
        hl(res, "DNN", t, tag="apn")
        f["dnn"] = t
    hl(res, "S-NSSAI", _text(nas_ie(tree, "SNSSAI")), tag="nssai")
    inner = [i["title"] for i in f.get("inner", [])]
    res["summary"] = "UE sends " + (inner[0] if inner else (pct or "a NAS payload")) + " to the core" + \
        (f" for DNN {f['dnn']}." if f.get("dnn") else ".")


def dl_nas_transport(res, tree, f):
    pct = _text(nas_ie(tree, "PayloadContainerType"))
    hl(res, "Payload", pct)
    hl(res, "PDU session ID", _text(nas_ie(tree, "PDUSessID")))
    kb = None
    if nas_ie(tree, "5GMMCause"):
        kb = _cause(res, tree, "5GMM", "5GMMCause", "critical", "AMF could not deliver the UE payload.")
    _timer(res, tree, "BackOffTimer", "Back-off timer")
    inner = [i["title"] for i in f.get("inner", [])]
    res["summary"] = "Core sends " + (inner[0] if inner else (pct or "a NAS payload")) + " to the UE" + (f" ({kb['name']})." if kb else ".")


def fgmm_status(res, tree, f):
    kb = _cause(res, tree, "5GMM", "5GMMCause", "warning")
    res["summary"] = f"5GMM status: {kb['name'] if kb else 'cause n/a'}."


# --- 5GSM ------------------------------------------------------------------------

def _psi(res, tree):
    hdr = nas_ie(tree, "5GSMHeader")
    psi = child_val(hdr, "PDUSessID") if hdr else None
    v = node_int(psi)
    hl(res, "PDU session ID", v)
    return v


def pdu_est_request(res, tree, f):
    psi = _psi(res, tree)
    hl(res, "PDU session type", _text(nas_ie(tree, "PDUSessType")))
    hl(res, "SSC mode", _text(nas_ie(tree, "SSCMode")))
    res["summary"] = f"UE requests PDU session {psi if psi is not None else ''} establishment.".replace("  ", " ")


def pdu_est_accept(res, tree, f):
    psi = _psi(res, tree)
    hl(res, "PDU session type", _text(nas_ie(tree, "PDUSessType")))
    hl(res, "SSC mode", _text(nas_ie(tree, "SSCMode")))
    addr = nas_ie(tree, "PDUAddress")
    if addr is not None and addr.get("h"):
        f["ip"] = addr["h"]
        hl(res, "PDU address", f["ip"], tag="ip")
    dnn = nas_ie(tree, "DNN")
    if dnn is not None:
        f["dnn"] = (dnn.get("h") or _text(dnn) or "").strip('"')
        hl(res, "DNN", f["dnn"], tag="apn")
    hl(res, "S-NSSAI", _text(nas_ie(tree, "SNSSAI")), tag="nssai")
    hl(res, "Session-AMBR", _text(nas_ie(tree, "SessAMBR")))
    if nas_ie(tree, "5GSMCause"):
        _cause(res, tree, "5GSM", "5GSMCause", "info", "Session accepted with a restriction.")
    res["summary"] = f"Network accepts PDU session {psi if psi is not None else ''}".rstrip() + \
        (f" on DNN {f['dnn']}" if f.get("dnn") else "") + (f" with address {f['ip']}" if f.get("ip") else "") + "."


def fgsm_reject(res, tree, f):
    _psi(res, tree)
    kb = _cause(res, tree, "5GSM", "5GSMCause")
    _timer(res, tree, "BackOffTimer", "Back-off timer")
    res["summary"] = f"{res['message']['title']}: {kb['name'] if kb else 'cause n/a'}."


def fgsm_status(res, tree, f):
    _psi(res, tree)
    kb = _cause(res, tree, "5GSM", "5GSMCause", "warning", "5GSM status reports a protocol error.")
    res["summary"] = f"5GSM status: {kb['name'] if kb else 'cause n/a'}."


def pdu_release_command(res, tree, f):
    _psi(res, tree)
    code = node_int(nas_ie(tree, "5GSMCause"))
    kb = _cause(res, tree, "5GSM", "5GSMCause", "info" if code == 36 else "warning", "Network releases the PDU session.")
    res["summary"] = f"Network releases the PDU session ({kb['name'] if kb else 'cause n/a'})."


def fgsm_generic(res, tree, f):
    _psi(res, tree)
    res["summary"] = f"{res['message']['title']}."


def _generic(res, tree, f):
    for ie in ("EMMCause", "ESMCause", "5GMMCause", "5GSMCause"):
        if nas_ie(tree, ie):
            _cause(res, tree, ie.replace("Cause", ""), ie, "warning")
            break


HANDLERS = {
    "EMMAttachRequest": attach_request, "EMMAttachAccept": attach_accept, "EMMAttachReject": attach_reject,
    "EMMAttachComplete": attach_complete, "EMMDetachRequestMO": detach_mo, "EMMDetachRequestMT": detach_mt,
    "EMMTrackingAreaUpdateRequest": tau_request, "EMMTrackingAreaUpdateAccept": tau_accept,
    "EMMTrackingAreaUpdateReject": tau_reject, "EMMServiceRequest": service_request,
    "EMMExtServiceRequest": ext_service_request, "EMMServiceReject": service_reject, "EMMServiceAccept": service_accept,
    "EMMAuthenticationRequest": auth_request, "EMMAuthenticationResponse": auth_response,
    "EMMAuthenticationFailure": auth_failure("EMM"), "EMMAuthenticationReject": auth_reject("EMM"),
    "EMMIdentityRequest": identity_request("IDType"), "EMMIdentityResponse": identity_response("ID"),
    "EMMSecurityModeCommand": smc("EMM"), "EMMSecurityModeReject": smc_reject("EMM"), "EMMStatus": emm_status,
    "EMMInformation": emm_information, "EMMDLNASTransport": nas_transport, "EMMULNASTransport": nas_transport,
    "EMMCSServiceNotification": cs_service_notification,
    "ESMPDNConnectivityRequest": pdn_conn_request, "ESMPDNConnectivityReject": esm_reject,
    "ESMActDefaultEPSBearerCtxtRequest": act_default_bearer, "ESMActDefaultEPSBearerCtxtReject": esm_reject,
    "ESMActDediEPSBearerCtxtRequest": act_dedicated_bearer, "ESMActDediEPSBearerCtxtReject": esm_reject,
    "ESMDeactEPSBearerCtxtRequest": deact_bearer, "ESMInformationResponse": esm_info_response,
    "ESMStatus": esm_status, "ESMPDNDisconnectReject": esm_reject, "ESMBearerResourceAllocReject": esm_reject,
    "ESMBearerResourceModifReject": esm_reject, "ESMModifyEPSBearerCtxtReject": esm_reject,
    "5GMMRegistrationRequest": reg_request, "5GMMRegistrationAccept": reg_accept, "5GMMRegistrationReject": reg_reject,
    "5GMMRegistrationComplete": reg_complete, "5GMMMODeregistrationRequest": dereg_mo,
    "5GMMMTDeregistrationRequest": dereg_mt, "5GMMServiceRequest": fg_service_request,
    "5GMMServiceReject": fg_service_reject, "5GMMServiceAccept": fg_service_accept,
    "5GMMAuthenticationRequest": fg_auth_request, "5GMMAuthenticationResponse": fg_auth_response,
    "5GMMAuthenticationFailure": auth_failure("5GMM"), "5GMMAuthenticationReject": auth_reject("5GMM"),
    "5GMMAuthenticationResult": fg_auth_result,
    "5GMMIdentityRequest": identity_request("5GSIDType"), "5GMMIdentityResponse": identity_response("5GSID"),
    "5GMMSecurityModeCommand": smc("5GMM"), "5GMMSecurityModeReject": smc_reject("5GMM"),
    "5GMMConfigurationUpdateCommand": config_update, "5GMMULNASTransport": ul_nas_transport,
    "5GMMDLNASTransport": dl_nas_transport, "5GMMStatus": fgmm_status,
    "5GSMPDUSessionEstabRequest": pdu_est_request, "5GSMPDUSessionEstabAccept": pdu_est_accept,
    "5GSMPDUSessionEstabReject": fgsm_reject, "5GSMPDUSessionModifReject": fgsm_reject,
    "5GSMPDUSessionModifCommandReject": fgsm_reject, "5GSMPDUSessionReleaseReject": fgsm_reject,
    "5GSMPDUSessionReleaseCommand": pdu_release_command, "5GSMStatus": fgsm_status,
    "5GSMPDUSessionReleaseRequest": fgsm_generic, "5GSMPDUSessionReleaseComplete": fgsm_generic,
    "5GSMPDUSessionModifRequest": fgsm_generic, "5GSMPDUSessionModifCommand": fgsm_generic,
    "5GSMPDUSessionModifComplete": fgsm_generic,
}
