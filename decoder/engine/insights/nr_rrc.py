"""NR RRC (TS 38.331) message analysis."""

from .. import radio
from ..causes import REESTABLISHMENT_CAUSES, SCG_FAILURE_TYPES, RLF_CAUSES, ESTABLISHMENT_CAUSES
from ..labels import split_release, pretty
from .common import (dig, find_all, find_first, has_key, choice, bits, plmn_str, hl, finding, human,
                     embedded_titles, embedded_results)
from .lte_rrc import _join

NEA = {"nea0": "NEA0 (null, no ciphering)", "nea1": "128-NEA1 (SNOW 3G)", "nea2": "128-NEA2 (AES)", "nea3": "128-NEA3 (ZUC)"}
NIA = {"nia0": "NIA0 (null, no integrity)", "nia1": "128-NIA1 (SNOW 3G)", "nia2": "128-NIA2 (AES)", "nia3": "128-NIA3 (ZUC)"}


def analyze(res, proto):
    val = res.get("_val")
    name = split_release(res["message"]["name"])[0]
    facts = res["facts"]
    facts["rat"] = "NR"
    fn = HANDLERS.get(name)
    if fn:
        fn(res, val, facts)
    elif proto["id"] == "nr-rrc.ue-nr-capability":
        _ue_nr_capability(res, val, facts)
    elif proto["id"] == "nr-rrc.ue-mrdc-capability":
        _ue_mrdc_capability(res, val, facts)
    elif proto["id"] == "nr-rrc.cell-group-config":
        _cell_group(res, val, facts, "Cell group")
    elif proto["id"] == "nr-rrc.radio-bearer-config":
        _radio_bearers(res, val, facts)
    if not res.get("summary"):
        res["summary"] = f"{res['message']['title']} on {proto['channel']}."


def _cell_meas(results):
    """measResult.cellResults -> {rsrp, rsrq, sinr} using the SSB result when present."""
    out = {}
    if not isinstance(results, dict):
        return out
    cell = results.get("resultsSSB-Cell") or results.get("resultsCSI-RS-Cell") or {}
    if isinstance(cell.get("rsrp"), int):
        out["rsrp"] = radio.nr_rsrp(cell["rsrp"])[0]
    if isinstance(cell.get("rsrq"), int):
        out["rsrq"] = radio.nr_rsrq(cell["rsrq"])[0]
    if isinstance(cell.get("sinr"), int):
        out["sinr"] = radio.nr_sinr(cell["sinr"])[0]
    return out


def _eutra_meas(m):
    out = {}
    if not isinstance(m, dict):
        return out
    if isinstance(m.get("rsrp"), int):
        out["rsrp"] = radio.lte_rsrp(m["rsrp"])[0]
    if isinstance(m.get("rsrq"), int):
        out["rsrq"] = radio.lte_rsrq(m["rsrq"])[0]
    if isinstance(m.get("sinr"), int):
        out["sinr"] = radio.lte_sinr(m["sinr"])[0]
    return out


def _fmt(m):
    p = []
    if "rsrp" in m:
        p.append(f"SS-RSRP {m['rsrp']} dBm")
    if "rsrq" in m:
        p.append(f"SS-RSRQ {m['rsrq']:g} dB")
    if "sinr" in m:
        p.append(f"SS-SINR {m['sinr']:g} dB")
    return ", ".join(p)


def measurement_report(res, val, facts):
    mr = find_first(val, "measResults")
    if not isinstance(mr, dict):
        return
    mid = mr.get("measId")
    facts["measId"] = mid
    hl(res, "Measurement ID", mid)
    serving = {}
    pci = None
    for s in (mr.get("measResultServingMOList") or [])[:4]:
        cell = s.get("measResultServingCell") or {}
        m = _cell_meas(dig(cell, "measResult", "cellResults"))
        if not serving:
            serving = m
            pci = cell.get("physCellId")
        hl(res, f"Serving cell {s.get('servCellId')} (PCI {cell.get('physCellId')})", _fmt(m),
           radio.QUALITY_TEXT[radio.quality_rsrp(m["rsrp"])] if "rsrp" in m else None, "rsrp",
           radio.quality_rsrp(m["rsrp"]) if "rsrp" in m else None)
    facts["serving"] = serving
    facts["servingPci"] = pci
    neigh = []
    nc = mr.get("measResultNeighCells")
    if choice(nc) == "measResultListNR":
        for c in nc[1]:
            m = _cell_meas(dig(c, "measResult", "cellResults"))
            neigh.append({"rat": "NR", "pci": c.get("physCellId"), **m})
    elif choice(nc) == "measResultListEUTRA":
        for c in nc[1]:
            m = _eutra_meas(c.get("measResult"))
            neigh.append({"rat": "LTE", "pci": c.get("eutra-PhysCellId"), **m})
    facts["neighbors"] = neigh
    for n in neigh[:6]:
        hl(res, f"{n['rat']} neighbour PCI {n['pci']}", _fmt(n) or "reported", None, "neighbor")
    best = max((n for n in neigh if "rsrp" in n), key=lambda n: n["rsrp"], default=None)
    parts = [f"Serving PCI {pci}: {_fmt(serving)}"] if serving else []
    if best:
        d = best["rsrp"] - serving["rsrp"] if "rsrp" in serving else None
        parts.append(f"best neighbour {best['rat']} PCI {best['pci']} at {best['rsrp']} dBm" + (f" ({'+' if d >= 0 else ''}{d} dB)" if d is not None else ""))
    res["summary"] = f"UE reports measurement ID {mid}. " + "; ".join(parts) + "."
    if "rsrp" in serving and serving["rsrp"] < -110:
        finding(res, "warning", "Weak NR coverage", f"Serving SS-RSRP {serving['rsrp']} dBm is below -110 dBm.",
                ["Cell edge, indoor penetration loss (worse on 3.5 GHz)", "Beam not reaching the UE"],
                ["Check SSB beam coverage and neighbour relations", "Check A2 / B2 thresholds for fallback to LTE"],
                category="coverage", field="rsrp")
    if "sinr" in serving and serving["sinr"] < 0:
        finding(res, "warning", "Low SS-SINR", f"Serving SS-SINR {serving['sinr']:g} dB. Throughput will be low and BLER high.",
                ["Inter-cell interference", "TDD frame misalignment / remote interference"], ["Check neighbouring gNB overlap and TDD sync"],
                category="interference", field="sinr")


def rrc_setup_request(res, val, facts):
    ue = find_first(val, "ue-Identity")
    cause = find_first(val, "establishmentCause")
    facts["estCause"] = cause
    txt = ESTABLISHMENT_CAUSES.get(cause, human(cause) if cause else None)
    hl(res, "Establishment cause", cause, txt)
    who = ""
    if choice(ue) == "ng-5G-S-TMSI-Part1":
        hl(res, "UE identity", "5G-S-TMSI part 1", "UE is registered (has a 5G-GUTI)")
        who = "using its 5G-S-TMSI, so it is already registered"
    elif choice(ue) == "randomValue":
        hl(res, "UE identity", "Random value", "No 5G-S-TMSI available")
        who = "with a random value because it has no 5G-S-TMSI (first registration)"
    res["summary"] = f"UE requests an NR RRC connection for {txt or 'an unknown cause'} {who}."


def rrc_setup(res, val, facts):
    res["summary"] = "gNB accepts the connection and configures SRB1 plus the master cell group."
    _cell_group(res, find_first(val, "masterCellGroup"), facts, "Master cell group", summary=False)


def rrc_setup_complete(res, val, facts):
    hl(res, "Selected PLMN index", find_first(val, "selectedPLMN-Identity"))
    amf = find_first(val, "registeredAMF")
    if isinstance(amf, dict):
        aid = bits(amf.get("amf-Identifier"))
        if aid is not None:
            hl(res, "Registered AMF", f"Region {aid >> 16}, Set {(aid >> 6) & 0x3FF}, Pointer {aid & 0x3F}")
    sn = find_first(val, "s-NSSAI-List")
    if sn:
        hl(res, "S-NSSAI list", ", ".join(_snssai(s) for s in sn))
    inner = embedded_titles(res)
    hl(res, "NAS message", inner[0] if inner else None, tag="nas")
    res["summary"] = "UE completes NR RRC setup" + (f" and carries NAS {inner[0]}." if inner else ".")


def _snssai(s):
    kind = choice(s)
    if kind == "sst":
        return f"SST {s[1]}"
    if kind == "sst-SD":
        v = bits(s[1])
        return f"SST {v >> 24}, SD 0x{v & 0xFFFFFF:06X}" if v is not None else "SST/SD"
    return str(s)


def rrc_reject(res, val, facts):
    wt = find_first(val, "waitTime")
    hl(res, "Wait time", f"{wt} s" if wt is not None else None)
    res["summary"] = "gNB rejects the RRC request" + (f"; UE waits {wt} s before retrying." if wt is not None else ".")
    finding(res, "critical", "NR RRC connection rejected", "The gNB refused admission or resume.",
            ["gNB admission control (max users / resources)", "Overload or AMF overload", "Unified access control barring"],
            ["Check gNB RRC user counters and load", "Check NG overload start from the AMF"], "TS 38.331 5.3.15",
            category="congestion", field="waitTime")


def rrc_release(res, val, facts):
    redir = find_first(val, "redirectedCarrierInfo")
    target = None
    if choice(redir) == "nr":
        f = find_first(redir, "carrierFreq")
        target = f"NR-ARFCN {f}" + (f" ({radio.nrarfcn_text(f)})" if f is not None and radio.nrarfcn_text(f) else "")
    elif choice(redir) == "eutra":
        f = find_first(redir, "eutraFrequency")
        target = f"LTE EARFCN {f}" + (f" ({radio.earfcn_text(f)})" if f is not None and radio.earfcn_text(f) else "")
    hl(res, "Redirect to", target, tag="redirect")
    facts["redirect"] = target
    susp = find_first(val, "suspendConfig")
    if susp is not None:
        hl(res, "Suspend to RRC_INACTIVE", "yes", "UE keeps its context and resumes later")
    wt = find_first(val, "waitTime")
    hl(res, "Wait time", f"{wt} s" if wt is not None else None)
    prio = find_first(val, "cellReselectionPriorities")
    if prio:
        hl(res, "Reselection priorities", "provided")
    s = "gNB releases the connection"
    if susp is not None:
        s = "gNB suspends the connection (UE goes to RRC_INACTIVE)"
    s += f" and redirects the UE to {target}." if target else "."
    res["summary"] = s
    if target and target.startswith("LTE"):
        finding(res, "info", "Redirect from NR to LTE",
                "Common for EPS fallback (voice when VoNR is not supported) or NR coverage loss.",
                checks=["If a voice call was starting, look for IMS signalling and the LTE TAU / Service Request that follows",
                        "If not, check NR coverage (A2 thresholds)"], category="mobility")


def rrc_reconfiguration(res, val, facts):
    parts = []
    rb = find_first(val, "radioBearerConfig")
    if isinstance(rb, dict) or (isinstance(rb, tuple) and choice(rb) == "RadioBearerConfig"):
        body = rb[1] if isinstance(rb, tuple) else rb
        drbs = body.get("drb-ToAddModList") or []
        for d in drbs:
            cn = d.get("cnAssociation")
            assoc = None
            if choice(cn) == "sdap-Config":
                assoc = f"PDU session {cn[1].get('pdu-Session')}"
            elif choice(cn) == "eps-BearerIdentity":
                assoc = f"EPS bearer {cn[1]}"
            hl(res, f"DRB {d.get('drb-Identity')}", assoc or "added", tag="drb")
        if drbs:
            parts.append(f"adds {len(drbs)} data bearer(s)")
    mcg = find_first(val, "masterCellGroup")
    scg = find_first(val, "secondaryCellGroup")
    for label, cg in (("MCG", mcg), ("SCG", scg)):
        body = cg[1] if isinstance(cg, tuple) else cg
        if not isinstance(body, dict):
            continue
        rws = find_first(body, "reconfigurationWithSync")
        if isinstance(rws, dict):
            pci = dig(rws, "spCellConfigCommon", "physCellId")
            ssb = dig(rws, "spCellConfigCommon", "downlinkConfigCommon", "frequencyInfoDL", "absoluteFrequencySSB")
            tgt = f"PCI {pci}" + (f" on NR-ARFCN {ssb}" if ssb is not None else "")
            if label == "MCG":
                parts.append(f"hands the UE over to {tgt}")
                facts["handover"] = {"pci": pci, "nrarfcn": ssb}
                hl(res, "Handover target", tgt, radio.nrarfcn_text(ssb) if ssb is not None else None, "handover")
                finding(res, "info", "Handover command", f"Reconfiguration with sync to {tgt} (T304 {rws.get('t304')}).",
                        checks=["Expect RRC Reconfiguration Complete on the target"], category="mobility", field="reconfigurationWithSync")
            else:
                parts.append(f"adds / changes the NR PSCell to {tgt}")
                facts["pscell"] = {"pci": pci, "nrarfcn": ssb}
                hl(res, "PSCell", tgt, radio.nrarfcn_text(ssb) if ssb is not None else None, "endc")
        scells = find_first(body, "sCellToAddModList") or []
        if scells:
            parts.append(f"adds {len(scells)} SCell(s) in the {label}")
            for s in scells[:4]:
                c = s.get("sCellConfigCommon") or {}
                hl(res, f"{label} SCell {s.get('sCellIndex')}", f"PCI {c.get('physCellId')}", tag="scell")
    mc = find_first(val, "measConfig")
    if isinstance(mc, dict):
        evs = []
        for rc in mc.get("reportConfigToAddModList") or []:
            r = dig(rc, "reportConfig", "reportConfigNR") or dig(rc, "reportConfig", "reportConfigInterRAT")
            if not isinstance(r, dict):
                continue
            trig = r.get("reportType")
            if choice(trig) in ("eventTriggered", "eventTriggered-r16"):
                ev = trig[1].get("eventId")
                if choice(ev):
                    evs.append(_nr_event_text(choice(ev), ev[1], trig[1]))
            elif choice(trig) == "periodical":
                evs.append("Periodic report")
        for e in evs[:6]:
            hl(res, "Report trigger", e, tag="event")
        facts["measEvents"] = evs
        parts.append(f"configures measurements ({len(evs)} report triggers)")
    nas = embedded_titles(res)
    nas = [t for t in nas if t and "Reconfiguration" not in t and "Config" not in t]
    if nas:
        parts.append(f"carries NAS {', '.join(nas)}")
    if has_key(val, "fullConfig"):
        parts.append("applies a full configuration")
    res["summary"] = ("gNB " + _join(parts) + ".") if parts else "gNB reconfigures the RRC connection."


def _nr_event_text(name, ev, cfg):
    def thr(t):
        k = choice(t)
        if k == "rsrp":
            return f"RSRP {radio.nr_rsrp(t[1])[1]}"
        if k == "rsrq":
            return f"RSRQ {radio.nr_rsrq(t[1])[1]}"
        if k == "sinr":
            return f"SINR {radio.nr_sinr(t[1])[1]}"
        return k or ""
    e = name.replace("event", "").upper()
    detail = ""
    if isinstance(ev, dict):
        if "a3-Offset" in ev:
            off = ev["a3-Offset"]
            detail = f"neighbour offset {off[1] * 0.5:g} dB better" if isinstance(off, tuple) else "neighbour better"
        elif "a1-Threshold" in ev:
            detail = f"serving above {thr(ev['a1-Threshold'])}"
        elif "a2-Threshold" in ev:
            detail = f"serving below {thr(ev['a2-Threshold'])}"
        elif "a4-Threshold" in ev:
            detail = f"neighbour above {thr(ev['a4-Threshold'])}"
        elif "a5-Threshold1" in ev:
            detail = f"serving below {thr(ev['a5-Threshold1'])} and neighbour above {thr(ev.get('a5-Threshold2'))}"
    ttt = cfg.get("timeToTrigger") if isinstance(cfg, dict) else None
    return f"{e}: {detail}" + (f" (TTT {ttt.replace('ms', '')} ms)" if ttt else "")


def _cell_group(res, cg, facts, label, summary=True):
    body = cg[1] if isinstance(cg, tuple) else cg
    if not isinstance(body, dict):
        return
    sp = body.get("spCellConfig") or {}
    rws = sp.get("reconfigurationWithSync")
    if isinstance(rws, dict):
        pci = dig(rws, "spCellConfigCommon", "physCellId")
        ssb = dig(rws, "spCellConfigCommon", "downlinkConfigCommon", "frequencyInfoDL", "absoluteFrequencySSB")
        hl(res, f"{label} SpCell", f"PCI {pci}" + (f", NR-ARFCN {ssb}" if ssb is not None else ""),
           radio.nrarfcn_text(ssb) if ssb is not None else None, "pci")
    bwp = find_first(sp, "firstActiveDownlinkBWP-Id")
    hl(res, f"{label} first active DL BWP", bwp)
    rlc = body.get("rlc-BearerToAddModList") or []
    if rlc:
        hl(res, f"{label} RLC bearers", len(rlc))
    if summary:
        res["summary"] = f"{label} configuration" + (f" with SpCell PCI {dig(rws, 'spCellConfigCommon', 'physCellId')}." if isinstance(rws, dict) else ".")


def _radio_bearers(res, val, facts):
    srbs = [s.get("srb-Identity") for s in (val.get("srb-ToAddModList") or [])] if isinstance(val, dict) else []
    drbs = val.get("drb-ToAddModList") or [] if isinstance(val, dict) else []
    hl(res, "SRBs", ", ".join(f"SRB{s}" for s in srbs) if srbs else None)
    for d in drbs:
        hl(res, f"DRB {d.get('drb-Identity')}", choice(d.get("cnAssociation")) or "added", tag="drb")
    res["summary"] = f"Radio bearer configuration: {len(srbs)} SRB(s), {len(drbs)} DRB(s)."


def reconfiguration_complete(res, val, facts):
    res["summary"] = "UE confirms it applied the RRC Reconfiguration."


def reestablishment_request(res, val, facts):
    ue = find_first(val, "ue-Identity") or {}
    cause = find_first(val, "reestablishmentCause")
    pci = ue.get("physCellId")
    facts["reestCause"] = cause
    facts["reestPci"] = pci
    hl(res, "Cause", cause, human(cause) if cause else None)
    hl(res, "Source PCI", pci, tag="pci")
    c = ue.get("c-RNTI")
    hl(res, "Old C-RNTI", f"0x{c:04X}" if isinstance(c, int) else None)
    kb = REESTABLISHMENT_CAUSES.get(cause)
    res["summary"] = f"UE lost its NR connection on PCI {pci} and requests re-establishment ({kb['title'].lower() if kb else cause})."
    if kb:
        finding(res, "critical" if cause in ("handoverFailure", "otherFailure") else "warning", kb["title"], kb["meaning"],
                kb["causes"], kb["checks"], "TS 38.331 5.3.7", category="radio", field="reestablishmentCause")


def reestablishment(res, val, facts):
    res["summary"] = "gNB accepts the re-establishment."


def reestablishment_complete(res, val, facts):
    res["summary"] = "UE completes re-establishment; the connection recovered."


def resume_request(res, val, facts):
    cause = find_first(val, "resumeCause")
    hl(res, "Resume cause", cause, human(cause) if cause else None)
    res["summary"] = f"UE in RRC_INACTIVE asks to resume its connection ({human(cause) if cause else 'cause n/a'})."


def resume(res, val, facts):
    res["summary"] = "gNB resumes the suspended connection."


def security_mode_command(res, val, facts):
    alg = find_first(val, "securityAlgorithmConfig") or {}
    c, i = alg.get("cipheringAlgorithm"), alg.get("integrityProtAlgorithm")
    hl(res, "Ciphering", NEA.get(c, c))
    hl(res, "Integrity", NIA.get(i, i))
    res["summary"] = f"gNB activates AS security: {NEA.get(c, c)} ciphering, {NIA.get(i, i) or 'no'} integrity."
    if c == "nea0":
        finding(res, "warning", "AS ciphering disabled (NEA0)", "RRC and user plane are not encrypted.", category="security")


def security_mode_complete(res, val, facts):
    res["summary"] = "UE activated AS security."


def security_mode_failure(res, val, facts):
    res["summary"] = "UE failed to activate AS security."
    finding(res, "critical", "AS security mode failure", "Integrity check of the Security Mode Command failed or algorithm unsupported.",
            ["KgNB mismatch (NAS security issue)", "Unsupported algorithm"], ["Check the NAS Security Mode procedure"],
            "TS 38.331 5.3.4", category="security")


def ue_capability_enquiry(res, val, facts):
    rats = [r.get("rat-Type") for r in (find_first(val, "ue-CapabilityRAT-RequestList") or [])]
    hl(res, "RATs requested", ", ".join(human(r) for r in rats if r))
    res["summary"] = f"gNB asks the UE for its capabilities ({', '.join(human(r) for r in rats if r)})."


def ue_capability_information(res, val, facts):
    lst = find_first(val, "ue-CapabilityRAT-ContainerList") or []
    rats = [c.get("rat-Type") for c in lst]
    hl(res, "Containers", ", ".join(human(r) for r in rats if r))
    for s in embedded_results(res):
        for h in s.get("highlights", [])[:6]:
            res["highlights"].append(h)
    res["summary"] = "UE reports its radio capabilities for " + (", ".join(human(r) for r in rats if r) or "NR") + "."


def _ue_nr_capability(res, val, facts):
    bands = [b.get("bandNR") for b in (find_first(val, "supportedBandListNR") or [])]
    hl(res, "NR bands", ", ".join(f"n{b}" for b in bands), f"{len(bands)} bands", "band")
    combos = find_first(val, "supportedBandCombinationList")
    if combos:
        hl(res, "Band combinations", len(combos))
    sa = find_first(val, "nrdc-Parameters")
    if sa:
        hl(res, "NR-DC", "supported")
    pdcp = find_first(val, "pdcp-Parameters") or {}
    hl(res, "Max ROHC sessions", pdcp.get("maxNumberROHC-ContextSessions"))
    facts["nrBands"] = bands
    res["summary"] = f"NR capability: {len(bands)} bands ({', '.join(f'n{b}' for b in bands[:10])})."


def _ue_mrdc_capability(res, val, facts):
    combos = find_first(val, "supportedBandCombinationList") or []
    hl(res, "MR-DC band combinations", len(combos))
    sample = []
    for c in combos[:4]:
        bl = c.get("bandList") or []
        sample.append(" + ".join(f"B{b[1].get('bandEUTRA')}" if choice(b) == "eutra" else f"n{b[1].get('bandNR')}" for b in bl))
    for s in sample:
        hl(res, "EN-DC combination", s, tag="endc")
    res["summary"] = f"MR-DC capability with {len(combos)} band combinations."


def information_transfer(res, val, facts):
    inner = embedded_titles(res)
    hl(res, "NAS message", inner[0] if inner else "NAS PDU", tag="nas")
    who = "UE sends" if res.get("direction") == "UL" else "gNB delivers"
    res["summary"] = f"{who} a NAS message transparently" + (f": {inner[0]}." if inner else ".")


def mib(res, val, facts):
    m = find_first(val, "mib") or {}
    sfn = bits(m.get("systemFrameNumber"))
    scs = m.get("subCarrierSpacingCommon")
    barred = m.get("cellBarred")
    hl(res, "SFN (6 MSB)", sfn)
    hl(res, "SCS common", {"scs15or60": "15 kHz (FR1) / 60 kHz (FR2)", "scs30or120": "30 kHz (FR1) / 120 kHz (FR2)"}.get(scs, scs))
    hl(res, "SSB subcarrier offset", m.get("ssb-SubcarrierOffset"))
    hl(res, "Cell barred", barred)
    hl(res, "Intra-frequency reselection", m.get("intraFreqReselection"))
    scs_txt = {"scs15or60": "15 kHz", "scs30or120": "30 kHz"}.get(scs, scs)
    res["summary"] = f"NR MIB: {scs_txt} common subcarrier spacing (FR1), cell {'barred' if barred == 'barred' else 'not barred'}."
    if barred == "barred":
        finding(res, "warning", "NR cell barred in MIB", "UEs may not camp on this cell.", category="access", field="cellBarred")


def sib1(res, val, facts):
    infos = find_first(val, "plmn-IdentityInfoList") or []
    first_plmn = None
    for inf in infos[:3]:
        for p in (inf.get("plmn-IdentityList") or [])[:3]:
            txt, key = plmn_str(p)
            if txt:
                hl(res, "PLMN", key, txt, "plmn")
                first_plmn = first_plmn or key
        tac = bits(inf.get("trackingAreaCode"))
        nci = bits(inf.get("cellIdentity"))
        hl(res, "TAC", tac, f"0x{tac:06X}" if tac is not None else None, "tac")
        hl(res, "NCI", nci, f"0x{nci:09X}" if nci is not None else None, "cellid")
        facts.update({"tac": tac, "cellId": nci})
    bands = [b.get("freqBandIndicatorNR") for b in (find_first(val, "frequencyBandList") or []) if isinstance(b, dict)]
    hl(res, "Band", ", ".join(f"n{b}" for b in bands if b) or None, tag="band")
    qrx = dig(find_first(val, "cellSelectionInfo") or {}, "q-RxLevMin")
    hl(res, "q-RxLevMin", f"{qrx * 2} dBm" if isinstance(qrx, int) else None)
    if find_first(val, "uac-BarringInfo"):
        finding(res, "warning", "Unified access control barring broadcast", "Some access categories are barred or throttled on this cell.",
                checks=["Check uac-BarringInfoSetList factors and times"], category="access", field="uac-BarringInfo")
    facts["plmn"] = first_plmn
    res["summary"] = f"NR SIB1: {first_plmn or 'PLMN n/a'}, TAC {facts.get('tac')}, bands {', '.join(f'n{b}' for b in bands if b) or 'n/a'}."


def system_information(res, val, facts):
    sibs = []
    for lst in find_all(val, "sib-TypeAndInfo"):
        for item in lst or []:
            if isinstance(item, tuple):
                sibs.append(item[0].replace("sib", "SIB").split("-")[0])
    hl(res, "SIBs", ", ".join(sibs))
    res["summary"] = f"NR System Information carrying {', '.join(sibs) or 'SIBs'}."


def paging(res, val, facts):
    recs = find_first(val, "pagingRecordList") or []
    n = 0
    for r in recs:
        uid = r.get("ue-Identity")
        if choice(uid) == "ng-5G-S-TMSI":
            v = bits(uid[1])
            hl(res, "Paged UE", f"5G-S-TMSI 5G-TMSI 0x{v & 0xFFFFFFFF:08X}" if v is not None else "5G-S-TMSI", tag="paging")
        elif choice(uid) == "fullI-RNTI":
            hl(res, "Paged UE", "full I-RNTI (RAN paging, RRC_INACTIVE)", tag="paging")
        n += 1
    res["summary"] = f"NR paging for {n} UE(s)."


def scg_failure(res, val, facts):
    rep = find_first(val, "failureReportSCG") or {}
    ftype = rep.get("failureType")
    facts["scgFailure"] = ftype
    title, meaning = SCG_FAILURE_TYPES.get(ftype, (human(ftype) if ftype else "SCG failure", "Secondary cell group failed."))
    hl(res, "Failure type", ftype, title)
    res["summary"] = f"UE reports SCG failure: {title}."
    finding(res, "critical", f"SCG failure: {title}", meaning, ["Weak SCG coverage", "UL power limit", "Unsupported SCG configuration"],
            ["Check SCG measurements in the report", "Check addition thresholds"], "TS 38.331 5.7.3", category="endc", field="failureType")


def mcg_failure(res, val, facts):
    rep = find_first(val, "failureReportMCG-r16") or {}
    ftype = rep.get("failureType-r16")
    res["summary"] = f"UE reports MCG failure ({RLF_CAUSES.get(ftype, ftype)}) and recovers via the SCG (fast MCG recovery)."
    finding(res, "critical", "MCG radio link failure", RLF_CAUSES.get(ftype, str(ftype)), ["Coverage loss on the MCG"],
            ["Check MCG measurements in the report"], "TS 38.331 5.7.3b", category="radio", field="failureType-r16")


def failure_information(res, val, facts):
    rlc = find_first(val, "failureInfoRLC-Bearer")
    if isinstance(rlc, dict):
        hl(res, "Failed RLC bearer", f"cell group {rlc.get('cellGroupId')}, LCID {rlc.get('logicalChannelIdentity')}")
        hl(res, "Failure type", rlc.get("failureType"))
    res["summary"] = "UE reports an RLC bearer failure (duplication leg)."
    finding(res, "warning", "RLC bearer failure", "An RLC entity used for PDCP duplication reached max retransmissions.",
            ["Poor radio on the secondary leg"], category="radio")


def ue_assistance(res, val, facts):
    oh = find_first(val, "overheatingAssistance")
    if oh is not None:
        red = []
        if isinstance(oh, dict):
            for k in ("reducedMaxCCs", "reducedMaxBW-FR1", "reducedMaxBW-FR2", "reducedMaxMIMO-LayersFR1", "reducedMaxMIMO-LayersFR2"):
                if k in oh:
                    red.append(pretty(k))
        hl(res, "Overheating", ", ".join(red) or "reported")
        finding(res, "warning", "UE reports overheating", "The UE asks the gNB to reduce its configuration to cool down. Throughput drops.",
                ["Device thermal limit (sustained high throughput, high UL power, hot ambient)"],
                ["Check device thermal logs", "Check what the UE asked to reduce"], category="device")
    for k, lab in (("drx-Preference-r16", "DRX preference"), ("maxBW-Preference-r16", "Max BW preference"),
                   ("maxCC-Preference-r16", "Max CC preference"), ("releasePreference-r16", "Release preference")):
        if find_first(val, k) is not None:
            hl(res, lab, "provided")
    res["summary"] = "UE sends assistance information" + (" reporting overheating." if oh is not None else ".")


def mobility_from_nr(res, val, facts):
    rat = find_first(val, "targetRAT-Type")
    hl(res, "Target RAT", rat)
    res["summary"] = f"gNB hands the UE over to {human(rat) if rat else 'another RAT'}."
    if rat == "eutra":
        finding(res, "info", "Inter-RAT handover NR to LTE", "Typical for EPS fallback (voice) or NR coverage loss.", category="mobility")


HANDLERS = {
    "measurementReport": measurement_report,
    "rrcSetupRequest": rrc_setup_request,
    "rrcSetup": rrc_setup,
    "rrcSetupComplete": rrc_setup_complete,
    "rrcReject": rrc_reject,
    "rrcRelease": rrc_release,
    "rrcReconfiguration": rrc_reconfiguration,
    "RRCReconfiguration": rrc_reconfiguration,
    "rrcReconfigurationComplete": reconfiguration_complete,
    "RRCReconfigurationComplete": reconfiguration_complete,
    "rrcReestablishmentRequest": reestablishment_request,
    "rrcReestablishment": reestablishment,
    "rrcReestablishmentComplete": reestablishment_complete,
    "rrcResumeRequest": resume_request,
    "rrcResumeRequest1": resume_request,
    "rrcResume": resume,
    "securityModeCommand": security_mode_command,
    "securityModeComplete": security_mode_complete,
    "securityModeFailure": security_mode_failure,
    "ueCapabilityEnquiry": ue_capability_enquiry,
    "ueCapabilityInformation": ue_capability_information,
    "ulInformationTransfer": information_transfer,
    "dlInformationTransfer": information_transfer,
    "mib": mib,
    "systemInformationBlockType1": sib1,
    "systemInformation": system_information,
    "paging": paging,
    "scgFailureInformation": scg_failure,
    "mcgFailureInformation": mcg_failure,
    "failureInformation": failure_information,
    "ueAssistanceInformation": ue_assistance,
    "mobilityFromNRCommand": mobility_from_nr,
}
