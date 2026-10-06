"""LTE RRC (TS 36.331) message analysis."""

from .. import radio
from ..causes import REESTABLISHMENT_CAUSES, SCG_FAILURE_TYPES, RLF_CAUSES, ESTABLISHMENT_CAUSES
from ..labels import split_release, pretty
from .common import (dig, find_all, find_first, has_key, choice, bits, plmn_str, hl, finding,
                     human, embedded_titles, embedded_results)

EEA = {"eea0": "EEA0 (null, no ciphering)", "eea1": "EEA1 (SNOW 3G)", "eea2": "EEA2 (AES)", "eea3-v1130": "EEA3 (ZUC)"}
EIA = {"eia0-v920": "EIA0 (null, no integrity)", "eia1": "EIA1 (SNOW 3G)", "eia2": "EIA2 (AES)", "eia3-v1130": "EIA3 (ZUC)"}


def analyze(res, proto):
    val = res.get("_val")
    name = split_release(res["message"]["name"])[0]
    fn = HANDLERS.get(name)
    facts = res["facts"]
    facts["rat"] = "LTE"
    if fn:
        fn(res, val, facts)
    elif proto["id"] == "lte-rrc.ue-eutra-capability":
        _ue_eutra_capability(res, val, facts)
    if not res.get("summary"):
        res["summary"] = f"{res['message']['title']} on {proto['channel']}."


# --- measurements -------------------------------------------------------------

def _lte_meas(m):
    out = {}
    if not isinstance(m, dict):
        return out
    rp = m.get("rsrpResult")
    rq = m.get("rsrqResult")
    sn = m.get("rs-sinr-Result-r13")
    if isinstance(rp, int):
        out["rsrp"] = radio.lte_rsrp(rp)[0]
    if isinstance(rq, int):
        out["rsrq"] = radio.lte_rsrq(rq)[0]
    if isinstance(sn, int):
        out["sinr"] = radio.lte_sinr(sn)[0]
    return out


def _nr_meas(m):
    out = {}
    if not isinstance(m, dict):
        return out
    rp = m.get("rsrpResult-r15")
    rq = m.get("rsrqResult-r15")
    sn = m.get("rs-sinr-Result-r15")
    if isinstance(rp, int):
        out["rsrp"] = radio.nr_rsrp(rp)[0]
    if isinstance(rq, int):
        out["rsrq"] = radio.nr_rsrq(rq)[0]
    if isinstance(sn, int):
        out["sinr"] = radio.nr_sinr(sn)[0]
    return out


def _fmt_meas(m):
    parts = []
    if "rsrp" in m:
        parts.append(f"RSRP {m['rsrp']} dBm")
    if "rsrq" in m:
        parts.append(f"RSRQ {m['rsrq']:g} dB")
    if "sinr" in m:
        parts.append(f"SINR {m['sinr']:g} dB")
    return ", ".join(parts)


def measurement_report(res, val, facts):
    mr = find_first(val, "measResults")
    if not isinstance(mr, dict):
        return
    meas_id = mr.get("measId")
    serving = _lte_meas(mr.get("measResultPCell"))
    hl(res, "Measurement ID", meas_id)
    facts["measId"] = meas_id
    if serving:
        facts["serving"] = serving
        if "rsrp" in serving:
            q = radio.quality_rsrp(serving["rsrp"])
            hl(res, "Serving RSRP", f"{serving['rsrp']} dBm", radio.QUALITY_TEXT[q], "rsrp", q)
        if "rsrq" in serving:
            q = radio.quality_rsrq(serving["rsrq"])
            hl(res, "Serving RSRQ", f"{serving['rsrq']:g} dB", radio.QUALITY_TEXT[q], "rsrq", q)
        if "sinr" in serving:
            q = radio.quality_sinr(serving["sinr"])
            hl(res, "Serving SINR", f"{serving['sinr']:g} dB", radio.QUALITY_TEXT[q], "sinr", q)
    neigh = []
    nc = mr.get("measResultNeighCells")
    kind = choice(nc)
    if kind == "measResultListEUTRA":
        for c in nc[1]:
            m = _lte_meas(c.get("measResult"))
            neigh.append({"rat": "LTE", "pci": c.get("physCellId"), **m})
    elif kind in ("measResultListUTRA", "measResultListGERAN", "measResultsCDMA2000"):
        hl(res, "Neighbour RAT", pretty(kind.replace("measResultList", "")))
    for lst in find_all(mr, "measResultNeighCellListNR-r15"):
        for c in lst or []:
            m = _nr_meas(c.get("measResultCell-r15"))
            neigh.append({"rat": "NR", "pci": c.get("pci-r15"), **m})
    scells = []
    for lst in find_all(mr, "measResultServFreqList-r10"):
        for c in lst or []:
            m = _lte_meas(c.get("measResultSCell-r10"))
            if m:
                scells.append({"servFreqId": c.get("servFreqId-r10"), **m})
    facts["neighbors"] = neigh
    best = None
    for n in neigh:
        if "rsrp" in n and (best is None or n["rsrp"] > best["rsrp"]):
            best = n
    for n in neigh[:6]:
        hl(res, f"{n['rat']} neighbour PCI {n['pci']}", _fmt_meas(n) or "reported",
           radio.QUALITY_TEXT[radio.quality_rsrp(n["rsrp"])] if "rsrp" in n else None, "neighbor")
    for s in scells[:4]:
        hl(res, f"SCell (servFreqId {s['servFreqId']})", _fmt_meas(s), None, "scell")
    parts = []
    if serving:
        parts.append(f"Serving cell {_fmt_meas(serving)}")
    if best is not None:
        delta = ""
        if "rsrp" in serving and "rsrp" in best:
            d = best["rsrp"] - serving["rsrp"]
            delta = f" ({'+' if d >= 0 else ''}{d} dB vs serving)"
        parts.append(f"best neighbour {best['rat']} PCI {best['pci']} at {best.get('rsrp')} dBm{delta}")
    elif not neigh:
        parts.append("no neighbours reported")
    res["summary"] = f"UE reports measurement ID {meas_id}. " + "; ".join(parts) + "."
    if "rsrp" in serving:
        if serving["rsrp"] < -110:
            finding(res, "warning", "Weak serving coverage",
                    f"Serving RSRP {serving['rsrp']} dBm is below -110 dBm, close to cell edge. "
                    "Radio link failure or handover is likely if it keeps dropping.",
                    ["Cell edge or indoor loss", "Missing neighbour or late handover"],
                    ["Check neighbour list and handover thresholds", "Drive test the area for a coverage hole"],
                    category="coverage", field="rsrpResult")
        if "rsrq" in serving and serving["rsrq"] < -15 and serving["rsrp"] > -100:
            finding(res, "warning", "Good signal but poor quality",
                    f"RSRP {serving['rsrp']} dBm is fine but RSRQ {serving['rsrq']:g} dB is poor. This points to "
                    "interference or high load rather than coverage.",
                    ["Inter-cell interference (pilot pollution)", "High cell load"],
                    ["Check overlapping cells and PRB utilisation", "Review downtilt / power of neighbours"],
                    category="interference", field="rsrqResult")
        if best is not None and best.get("rat") == "LTE" and "rsrp" in best and best["rsrp"] - serving["rsrp"] >= 3:
            finding(res, "info", "Stronger neighbour reported",
                    f"Neighbour PCI {best['pci']} is {best['rsrp'] - serving['rsrp']} dB stronger than the serving cell. "
                    "A handover command should follow if this is an A3 event report.",
                    checks=["Confirm an RRC Connection Reconfiguration with mobilityControlInfo follows"],
                    category="mobility")


# --- connection management -------------------------------------------------------

def rrc_connection_request(res, val, facts):
    ue_id = find_first(val, "ue-Identity")
    cause = find_first(val, "establishmentCause")
    facts["estCause"] = cause
    cause_txt = ESTABLISHMENT_CAUSES.get(cause, human(cause) if cause else None)
    hl(res, "Establishment cause", cause, cause_txt)
    who = ""
    if choice(ue_id) == "s-TMSI":
        st = ue_id[1]
        mmec, mtmsi = bits(st.get("mmec")), bits(st.get("m-TMSI"))
        hl(res, "UE identity", f"S-TMSI (MMEC {mmec}, M-TMSI 0x{mtmsi:08X})", tag="tmsi")
        who = "using its S-TMSI, so it is already registered"
    elif choice(ue_id) == "randomValue":
        hl(res, "UE identity", "Random value", "No valid S-TMSI")
        who = "with a random value because it has no S-TMSI (typical for a first attach)"
    res["summary"] = f"UE requests an RRC connection for {cause_txt or 'an unknown cause'} {who}."


def rrc_connection_setup(res, val, facts):
    rr = find_first(val, "radioResourceConfigDedicated")
    srbs = [s.get("srb-Identity") for s in (find_first(rr, "srb-ToAddModList") or [])]
    hl(res, "SRBs configured", ", ".join(f"SRB{s}" for s in srbs) if srbs else None)
    res["summary"] = "eNB accepts the connection and configures signalling radio bearer SRB1. The UE answers with RRC Connection Setup Complete."


def rrc_connection_setup_complete(res, val, facts):
    sel = find_first(val, "selectedPLMN-Identity")
    hl(res, "Selected PLMN index", sel, "Index into the PLMN list of SIB1")
    mme = find_first(val, "registeredMME")
    if isinstance(mme, dict):
        txt, _ = plmn_str(mme.get("plmn-Identity"))
        hl(res, "Registered MME", f"MMEGI {bits(mme.get('mmegi'))}, MMEC {bits(mme.get('mmec'))}", txt)
    inner = embedded_titles(res)
    hl(res, "NAS message", inner[0] if inner else None, tag="nas")
    res["summary"] = "UE completes RRC connection setup" + (f" and carries NAS {inner[0]}." if inner else ".")


def rrc_connection_reject(res, val, facts):
    wt = find_first(val, "waitTime")
    ext = find_first(val, "extendedWaitTime-r10")
    hl(res, "Wait time", f"{wt} s" if wt is not None else None)
    hl(res, "Extended wait time", f"{ext} s" if ext is not None else None)
    deprio = find_first(val, "deprioritisationReq-r11")
    if isinstance(deprio, dict):
        hl(res, "Deprioritisation", f"{deprio.get('deprioritisationType-r11')} for {deprio.get('deprioritisationTimer-r11')}")
    res["summary"] = f"eNB rejects the RRC connection request. UE must wait {wt} s before retrying." if wt is not None \
        else "eNB rejects the RRC connection request."
    finding(res, "critical", "RRC connection rejected by the eNB",
            "The eNB refused admission. The UE cannot reach the core network until the wait time expires.",
            ["eNB admission control: max connected users reached", "Overload or congestion on the cell",
             "MME overload indication towards the eNB", "Access barring or deprioritisation of this frequency"],
            ["Check eNB connected-user counters and CPU load", "Check S1 overload start messages from the MME",
             "Review RRC setup success rate KPI for the cell"],
            "TS 36.331 5.3.3.8", category="congestion", field="waitTime")


def rrc_connection_release(res, val, facts):
    cause = find_first(val, "releaseCause")
    facts["releaseCause"] = cause
    hl(res, "Release cause", cause, human(cause) if cause else None)
    redir = find_first(val, "redirectedCarrierInfo")
    target = None
    if redir is not None:
        kind = choice(redir)
        body = redir[1] if kind else None
        if kind == "eutra":
            target = f"LTE EARFCN {body}" + (f" ({radio.earfcn_text(body)})" if radio.earfcn_text(body) else "")
        elif kind and kind.startswith("nr"):
            ssb = find_first(body, "carrierFreq-r15")
            target = f"NR ARFCN {ssb}" if ssb is not None else "NR"
        elif kind == "geran":
            target = "GSM (GERAN)"
        elif kind in ("utra-FDD", "utra-TDD", "utra-TDD-r10"):
            target = f"WCDMA UARFCN {body}" if isinstance(body, int) else "UMTS"
        elif kind:
            target = pretty(kind)
        hl(res, "Redirect to", target, tag="redirect")
        facts["redirect"] = target
    prio = find_first(val, "freqPriorityListEUTRA")
    if prio:
        hl(res, "Idle mode priorities", ", ".join(f"EARFCN {p.get('carrierFreq')} prio {p.get('cellReselectionPriority')}" for p in prio[:4]))
    wt = find_first(val, "extendedWaitTime-r10")
    hl(res, "Extended wait time", f"{wt} s" if wt is not None else None)
    s = "eNB releases the RRC connection"
    s += f" (cause {human(cause).lower()})" if cause else ""
    s += f" and redirects the UE to {target}." if target else ". UE returns to idle."
    res["summary"] = s
    if cause == "cs-FallbackHighPriority-v1020" or (target and ("GSM" in target or "WCDMA" in target or "UMTS" in target)):
        finding(res, "info", "Redirection to 2G / 3G",
                "Typical for CS fallback (voice call without VoLTE) or a coverage based redirect.",
                checks=["If a voice call was expected on VoLTE, check IMS registration and the QCI 1 bearer",
                        "Check Extended Service Request with CSFB just before this release"], category="mobility")
    if cause == "loadBalancingTAUrequired":
        finding(res, "info", "Load balancing release", "The UE must perform a tracking area update after release.",
                category="mobility")
    if target and target.startswith("NR"):
        finding(res, "info", "Redirection to NR", "eNB steers the UE to an NR carrier.", category="mobility")


def rrc_connection_reconfiguration(res, val, facts):
    parts = []
    mci = find_first(val, "mobilityControlInfo")
    if isinstance(mci, dict):
        pci = mci.get("targetPhysCellId")
        freq = dig(mci, "carrierFreq", "dl-CarrierFreq")
        t304 = mci.get("t304")
        tgt = f"PCI {pci}" + (f" on EARFCN {freq}" if freq is not None else " (intra-frequency)")
        hl(res, "Handover target", tgt, radio.earfcn_text(freq) if freq is not None else None, "handover")
        hl(res, "T304", t304)
        newid = bits(mci.get("newUE-Identity"))
        hl(res, "New C-RNTI", f"0x{newid:04X}" if newid is not None else None)
        parts.append(f"hands the UE over to {tgt}")
        facts["handover"] = {"pci": pci, "earfcn": freq}
        finding(res, "info", "Handover command", f"Handover to {tgt}. UE must complete random access on the target before T304 ({t304}) expires.",
                checks=["Expect RRC Connection Reconfiguration Complete on the target cell",
                        "A re-establishment with handoverFailure afterwards means the handover failed"],
                category="mobility", field="mobilityControlInfo")
    mc = find_first(val, "measConfig")
    if isinstance(mc, dict):
        events = []
        for rc in mc.get("reportConfigToAddModList") or []:
            cfg = dig(rc, "reportConfig", "reportConfigEUTRA") or dig(rc, "reportConfig", "reportConfigInterRAT")
            if not isinstance(cfg, dict):
                continue
            trig = cfg.get("triggerType")
            if choice(trig) == "event":
                ev = dig(trig, "event", "eventId")
                evname = choice(ev)
                if evname:
                    events.append(_event_text(evname, ev[1], cfg))
            elif choice(trig) == "periodical":
                events.append("Periodic report")
        objs = mc.get("measObjectToAddModList") or []
        freqs = []
        for mo in objs:
            o = mo.get("measObject")
            kind = choice(o)
            if kind == "measObjectEUTRA":
                freqs.append(f"EARFCN {o[1].get('carrierFreq')}")
            elif kind == "measObjectNR-r15":
                freqs.append(f"NR-ARFCN {o[1].get('carrierFreq-r15')}")
            elif kind:
                freqs.append(pretty(kind))
        if freqs:
            hl(res, "Measurement objects", ", ".join(freqs[:6]))
        for e in events[:6]:
            hl(res, "Report trigger", e, tag="event")
        gap = find_first(mc, "measGapConfig")
        if choice(gap) == "setup":
            hl(res, "Measurement gap", choice(find_first(gap, "gapOffset")))
        facts["measEvents"] = events
        parts.append(f"configures measurements ({len(objs)} objects, {len(events)} report triggers)")
    rr = find_first(val, "radioResourceConfigDedicated")
    if isinstance(rr, dict):
        drbs = rr.get("drb-ToAddModList") or []
        for d in drbs:
            hl(res, f"DRB {d.get('drb-Identity')}", f"EPS bearer {d.get('eps-BearerIdentity')}",
               (dig(d, "rlc-Config") and choice(d["rlc-Config"])) or None, "drb")
        if drbs:
            parts.append(f"adds {len(drbs)} data bearer(s)")
        rel = rr.get("drb-ToReleaseList") or []
        if rel:
            parts.append(f"releases DRB {', '.join(str(x) for x in rel)}")
        drx = find_first(rr, "drx-Config")
        if choice(drx) == "setup":
            d = drx[1]
            hl(res, "Connected DRX", f"cycle {choice(d.get('longDRX-CycleStartOffset'))}, inactivity {d.get('drx-InactivityTimer')}")
    scells = find_first(val, "sCellToAddModList-r10") or []
    for s in scells:
        info = dig(s, "cellIdentification-r10") or {}
        hl(res, f"SCell {s.get('sCellIndex-r10')}", f"PCI {info.get('physCellId-r10')}, EARFCN {info.get('dl-CarrierFreq-r10')}",
           radio.earfcn_text(info.get("dl-CarrierFreq-r10")) if info.get("dl-CarrierFreq-r10") is not None else None, "scell")
    if scells:
        parts.append(f"adds {len(scells)} SCell(s) for carrier aggregation")
        facts["scells"] = len(scells)
    nrc = find_first(val, "nr-Config-r15")
    if choice(nrc) == "setup":
        parts.append("adds an NR secondary cell group (EN-DC)")
        hl(res, "EN-DC", "NR SCG configured", tag="endc")
        facts["endc"] = "add"
        finding(res, "info", "EN-DC: NR leg being added", "The eNB adds an NR secondary cell group. See the embedded NR RRC Reconfiguration for the PSCell.",
                checks=["Expect RRC Connection Reconfiguration Complete with scg-ConfigResponseNR",
                        "SCG Failure Information NR afterwards means the NR leg failed"], category="endc")
    elif choice(nrc) == "release":
        parts.append("releases the NR secondary cell group")
        hl(res, "EN-DC", "NR SCG released", tag="endc")
        facts["endc"] = "release"
    nas_titles = embedded_titles(res)
    nas_t = [t for t in nas_titles if t and "Capability" not in t and "Reconfiguration" not in t and "Bearer Config" not in t]
    if nas_t:
        parts.append(f"carries NAS {', '.join(nas_t)}")
    sec = find_first(val, "securityConfigHO")
    if sec is not None:
        hl(res, "Security config for HO", "present")
    res["summary"] = ("eNB " + _join(parts) + ".") if parts else "eNB reconfigures the RRC connection."


def _event_text(evname, ev, cfg):
    def thr(t):
        kind = choice(t)
        if kind == "threshold-RSRP":
            return f"RSRP {radio.lte_rsrp(t[1])[1]}"
        if kind == "threshold-RSRQ":
            return f"RSRQ {radio.lte_rsrq(t[1])[1]}"
        if kind == "nr-RSRP-r15":
            return f"NR RSRP {radio.nr_rsrp(t[1])[1]}"
        if kind == "nr-RSRQ-r15":
            return f"NR RSRQ {radio.nr_rsrq(t[1])[1]}"
        return human(kind) if kind else ""
    e = evname.replace("event", "").upper().replace("-R15", "").replace("-R13", "")
    detail = ""
    if isinstance(ev, dict):
        if "a3-Offset" in ev:
            detail = f"neighbour offset {ev['a3-Offset'] * 0.5:g} dB better than serving"
        elif "a1-Threshold" in ev:
            detail = f"serving above {thr(ev['a1-Threshold'])}"
        elif "a2-Threshold" in ev:
            detail = f"serving below {thr(ev['a2-Threshold'])}"
        elif "a4-Threshold" in ev:
            detail = f"neighbour above {thr(ev['a4-Threshold'])}"
        elif "a5-Threshold1" in ev:
            detail = f"serving below {thr(ev['a5-Threshold1'])} and neighbour above {thr(ev.get('a5-Threshold2'))}"
        elif "b1-Threshold" in ev or "b1-ThresholdNR-r15" in ev:
            detail = f"inter-RAT neighbour above {thr(ev.get('b1-ThresholdNR-r15') or ev.get('b1-Threshold'))}"
        elif "b2-Threshold1" in ev:
            detail = f"serving below {thr(ev['b2-Threshold1'])} and inter-RAT above {thr(ev.get('b2-Threshold2NR-r15') or ev.get('b2-Threshold2'))}"
    ttt = cfg.get("timeToTrigger")
    hyst = cfg.get("hysteresis")
    extra = []
    if hyst is not None:
        extra.append(f"hyst {hyst * 0.5:g} dB")
    if ttt:
        extra.append(f"TTT {ttt.replace('ms', '')} ms")
    return f"{e}: {detail}" + (f" ({', '.join(extra)})" if extra else "")


def _join(parts):
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def reconfiguration_complete(res, val, facts):
    res["summary"] = "UE confirms it applied the RRC Connection Reconfiguration."
    if has_key(val, "scg-ConfigResponseNR-r15"):
        res["summary"] = "UE confirms the reconfiguration, including the NR SCG configuration (EN-DC)."


def reestablishment_request(res, val, facts):
    ue = find_first(val, "ue-Identity") or {}
    cause = find_first(val, "reestablishmentCause")
    crnti = bits(ue.get("c-RNTI"))
    pci = ue.get("physCellId")
    facts["reestCause"] = cause
    facts["reestPci"] = pci
    hl(res, "Cause", cause, human(cause) if cause else None)
    hl(res, "Source PCI", pci, tag="pci")
    hl(res, "Old C-RNTI", f"0x{crnti:04X}" if crnti is not None else None)
    kb = REESTABLISHMENT_CAUSES.get(cause)
    res["summary"] = (f"UE lost its connection on PCI {pci} and requests re-establishment "
                      f"({kb['title'].lower() if kb else human(cause)}).")
    if kb:
        finding(res, "critical" if cause in ("handoverFailure", "otherFailure") else "warning",
                kb["title"], kb["meaning"], kb["causes"], kb["checks"], "TS 36.331 5.3.7", category="radio",
                field="reestablishmentCause")


def reestablishment(res, val, facts):
    res["summary"] = "eNB accepts the re-establishment and restores SRB1. The connection continues on this cell."


def reestablishment_complete(res, val, facts):
    res["summary"] = "UE completes re-establishment. Service recovered after the radio problem."
    rlf = has_key(val, "rlf-InfoAvailable-r10")
    if rlf:
        hl(res, "RLF report available", "yes", "eNB can fetch it with UE Information Request")


def reestablishment_reject(res, val, facts):
    res["summary"] = "eNB rejects the re-establishment. The UE drops to idle and must start a new connection (call / data drop)."
    finding(res, "critical", "Re-establishment rejected (call drop)",
            "The cell receiving the request has no UE context, so the connection cannot be recovered.",
            ["UE re-established on a cell of another eNB without context fetch (no X2 / neighbour relation)",
             "Context already released on the source eNB", "Short MAC-I verification failed"],
            ["Check X2 links and neighbour relations between source and target", "Check whether the UE re-established on an unexpected cell",
             "Review the radio conditions before the failure"], "TS 36.331 5.3.7.8", category="radio")


def security_mode_command(res, val, facts):
    alg = find_first(val, "securityAlgorithmConfig") or {}
    c, i = alg.get("cipheringAlgorithm"), alg.get("integrityProtAlgorithm")
    hl(res, "Ciphering", EEA.get(c, c))
    hl(res, "Integrity", EIA.get(i, i))
    res["summary"] = f"eNB activates AS security with {EEA.get(c, c)} ciphering and {EIA.get(i, i)} integrity."
    if c == "eea0":
        finding(res, "warning", "AS ciphering disabled (EEA0)", "User plane and RRC are not encrypted.",
                checks=["Expected only for emergency calls without a SIM or in lab setups"], category="security")


def security_mode_complete(res, val, facts):
    res["summary"] = "UE activated AS security successfully."


def security_mode_failure(res, val, facts):
    res["summary"] = "UE could not activate AS security."
    finding(res, "critical", "AS security mode failure", "The UE failed integrity verification of the Security Mode Command or does not support the algorithm.",
            ["KeNB mismatch between UE and eNB (NAS security problem upstream)", "Unsupported algorithm"],
            ["Check NAS Security Mode procedure before this", "Compare selected algorithms with UE capability"],
            "TS 36.331 5.3.4", category="security")


def ue_capability_enquiry(res, val, facts):
    rats = find_first(val, "ue-CapabilityRequest") or []
    hl(res, "RATs requested", ", ".join(human(r) for r in rats))
    bands = find_first(val, "requestedFrequencyBands-r11") or []
    if bands:
        hl(res, "Bands filter", ", ".join(f"B{b}" for b in bands))
    nr = find_first(val, "requestedFreqBandsNR-MRDC-r15")
    if nr:
        hl(res, "MR-DC filter", "requested")
    res["summary"] = f"eNB asks the UE for its radio capabilities ({', '.join(human(r) for r in rats) or 'EUTRA'})."


def ue_capability_information(res, val, facts):
    lst = find_first(val, "ue-CapabilityRAT-ContainerList") or []
    rats = [c.get("rat-Type") for c in lst]
    hl(res, "Containers", ", ".join(human(r) for r in rats if r))
    subs = embedded_results(res)
    for s in subs:
        for h in s.get("highlights", [])[:6]:
            res["highlights"].append(h)
    res["summary"] = "UE reports its radio capabilities for " + (", ".join(human(r) for r in rats if r) or "EUTRA") + "."


def _ue_eutra_capability(res, val, facts):
    cat = val.get("ue-Category") if isinstance(val, dict) else None
    cats = [cat] + [x for x in [find_first(val, "ue-Category-v1020"), find_first(val, "ue-Category-v1170"),
                                find_first(val, "ue-Category-v11a0")] if x]
    dl = find_first(val, "ue-CategoryDL-r12")
    ul = find_first(val, "ue-CategoryUL-r12")
    hl(res, "UE category", " / ".join(str(c) for c in cats if c is not None))
    if dl is not None:
        hl(res, "DL / UL category", f"DL {dl}, UL {ul}")
    bands = [b.get("bandEUTRA") for b in (find_first(val, "supportedBandListEUTRA") or [])]
    hl(res, "LTE bands", ", ".join(f"B{b}" for b in bands), f"{len(bands)} bands", "band")
    combos = find_first(val, "supportedBandCombination-r10")
    if combos:
        hl(res, "CA band combinations", len(combos))
    en = find_first(val, "en-DC-r15")
    if en:
        hl(res, "EN-DC support", "yes")
    facts["bands"] = bands
    res["summary"] = f"LTE capability: category {cat}, {len(bands)} supported bands ({', '.join(f'B{b}' for b in bands[:8])}{'...' if len(bands) > 8 else ''})."


def information_transfer(res, val, facts):
    inner = embedded_titles(res)
    hl(res, "NAS message", inner[0] if inner else "NAS PDU", tag="nas")
    direction = "UE sends" if res.get("direction") == "UL" else "eNB delivers"
    res["summary"] = f"{direction} a NAS message transparently" + (f": {inner[0]}." if inner else ".")


def mib(res, val, facts):
    m = val.get("message") if isinstance(val, dict) and isinstance(val.get("message"), dict) else find_first(val, "masterInformationBlock") or {}
    bw = m.get("dl-Bandwidth")
    sfn = bits(m.get("systemFrameNumber"))
    mhz = {"n6": "1.4", "n15": "3", "n25": "5", "n50": "10", "n75": "15", "n100": "20"}.get(bw)
    hl(res, "DL bandwidth", f"{mhz} MHz" if mhz else bw, f"{bw[1:]} RB" if bw else None, "bandwidth")
    hl(res, "SFN (8 MSB)", f"{sfn} (frames {sfn * 4}-{sfn * 4 + 3})" if sfn is not None else None)
    phich = m.get("phich-Config") or {}
    hl(res, "PHICH", f"{phich.get('phich-Duration')}, Ng {phich.get('phich-Resource')}")
    facts["bandwidth"] = mhz
    res["summary"] = f"MIB: {mhz} MHz downlink bandwidth, system frame {sfn * 4 if sfn is not None else '?'}."


def sib1(res, val, facts):
    cari = find_first(val, "cellAccessRelatedInfo") or {}
    plmns = []
    for p in cari.get("plmn-IdentityList") or []:
        txt, key = plmn_str(p.get("plmn-Identity"))
        if txt:
            plmns.append((txt, key))
    for txt, key in plmns[:4]:
        hl(res, "PLMN", key, txt, "plmn")
    tac = bits(cari.get("trackingAreaCode"))
    eci = bits(cari.get("cellIdentity"))
    hl(res, "TAC", tac, f"0x{tac:04X}" if tac is not None else None, "tac")
    if eci is not None:
        hl(res, "Cell identity (ECI)", eci, f"eNB ID {eci >> 8}, cell {eci & 0xFF}", "cellid")
    barred = cari.get("cellBarred")
    hl(res, "Cell barred", barred)
    band = find_first(val, "freqBandIndicator")
    hl(res, "Band", f"B{band}" if band is not None else None, tag="band")
    qrx = find_first(val, "q-RxLevMin")
    hl(res, "q-RxLevMin", f"{qrx * 2} dBm" if qrx is not None else None)
    tdd = find_first(val, "tdd-Config")
    if isinstance(tdd, dict):
        hl(res, "TDD config", f"{tdd.get('subframeAssignment')}, special {tdd.get('specialSubframePatterns')}")
    facts.update({"plmn": plmns[0][1] if plmns else None, "tac": tac, "cellId": eci, "band": band})
    res["summary"] = (f"Cell broadcasts {plmns[0][0] if plmns else 'its PLMN'}, TAC {tac}, "
                      f"eNB {eci >> 8 if eci is not None else '?'} cell {eci & 0xFF if eci is not None else '?'} on band {band}.")
    if barred == "barred":
        finding(res, "warning", "Cell is barred", "UEs may not camp on this cell. Selection will move to another cell.",
                ["Cell blocked by O&M", "Cell in maintenance"], ["Check cell admin state"], category="access", field="cellBarred")
    if cari.get("csg-Indication"):
        finding(res, "info", "CSG cell", "Only members of the closed subscriber group can access this cell.", category="access")


def system_information(res, val, facts):
    sibs = []
    for lst in find_all(val, "sib-TypeAndInfo"):
        for item in lst or []:
            if isinstance(item, tuple):
                sibs.append(item)
    names = []
    for kind, body in sibs:
        n = kind.replace("sib", "SIB").split("-")[0]
        names.append(n)
        if kind == "sib2":
            ac = body.get("ac-BarringInfo")
            if ac:
                finding(res, "warning", "Access class barring active (SIB2)",
                        "The cell restricts access for some access classes. Connection attempts may be delayed or blocked.",
                        ["Congestion control by the operator", "Emergency / disaster mode"],
                        ["Check ac-BarringForMO-Data / ac-BarringForMO-Signalling factors"], category="access", field="ac-BarringInfo")
            rach = dig(body, "radioResourceConfigCommon", "rach-ConfigCommon", "preambleInfo", "numberOfRA-Preambles")
            hl(res, "RACH preambles", rach)
            ul = dig(body, "freqInfo", "ul-Bandwidth")
            hl(res, "UL bandwidth", ul)
        if kind == "sib3":
            hl(res, "s-IntraSearch", f"{body.get('s-IntraSearch', 0) * 2} dB" if isinstance(body.get("s-IntraSearch"), int) else None)
            hl(res, "threshServingLow", f"{dig(body, 'cellReselectionServingFreqInfo', 'threshServingLow') * 2} dB"
               if isinstance(dig(body, 'cellReselectionServingFreqInfo', 'threshServingLow'), int) else None)
        if kind == "sib5":
            for f in (body.get("interFreqCarrierFreqList") or [])[:5]:
                hl(res, "Inter-frequency", f"EARFCN {f.get('dl-CarrierFreq')}, priority {f.get('cellReselectionPriority')}",
                   radio.earfcn_text(f.get("dl-CarrierFreq")))
        if kind == "sib24-v1530":
            for f in (body.get("carrierFreqListNR-r15") or [])[:4]:
                hl(res, "NR carrier for reselection", f"NR-ARFCN {f.get('carrierFreq-r15')}", radio.nrarfcn_text(f.get("carrierFreq-r15")))
    hl(res, "SIBs", ", ".join(names))
    res["summary"] = f"System Information carrying {', '.join(names) or 'SIBs'}."


def paging(res, val, facts):
    recs = find_first(val, "pagingRecordList") or []
    ids = []
    imsi_paging = False
    for r in recs:
        uid = r.get("ue-Identity")
        dom = r.get("cn-Domain")
        if choice(uid) == "s-TMSI":
            ids.append(f"S-TMSI M-TMSI 0x{bits(uid[1].get('m-TMSI')):08X} ({dom})")
        elif choice(uid) == "imsi":
            ids.append(f"IMSI {''.join(str(d) for d in uid[1])} ({dom})")
            imsi_paging = True
    for i in ids[:6]:
        hl(res, "Paged UE", i, tag="paging")
    if find_first(val, "systemInfoModification"):
        hl(res, "System info modification", "true", "SIBs are about to change")
    if find_first(val, "etws-Indication") or find_first(val, "cmas-Indication-r9"):
        hl(res, "Public warning", "ETWS / CMAS indication")
    res["summary"] = f"Paging for {len(ids)} UE(s)." if ids else "Paging without UE records (system information change or warning)."
    if imsi_paging:
        finding(res, "warning", "Paging with IMSI", "The network pages with IMSI when it lost the UE context (for example after an MME restart). "
                "The UE must detach locally and re-attach.", checks=["Check MME restarts / S1 resets at this time"], category="network")


def scg_failure_nr(res, val, facts):
    rep = find_first(val, "failureReportSCG-NR-r15") or {}
    ftype = rep.get("failureType-r15") or find_first(rep, "failureType-v1610")
    facts["scgFailure"] = ftype
    title, meaning = SCG_FAILURE_TYPES.get(ftype, (human(ftype) if ftype else "SCG failure", "NR leg failed."))
    hl(res, "Failure type", ftype, title)
    for f in (rep.get("measResultFreqListNR-r15") or [])[:4]:
        res_ = dig(f, "measResultServingCell-r15")
        hl(res, "NR frequency", f"NR-ARFCN {f.get('carrierFreq-r15')}", radio.nrarfcn_text(f.get("carrierFreq-r15")))
    res["summary"] = f"UE reports EN-DC SCG failure: {title}. The NR leg is lost; LTE anchor stays up."
    finding(res, "critical", f"EN-DC SCG failure: {title}", meaning,
            ["Weak or interfered NR coverage", "NR uplink power limited (EN-DC power sharing)",
             "SCG configuration not supported by the UE"],
            ["Check NR SS-RSRP / SINR in the embedded measResultSCG", "Check B1 threshold used to add NR (too low adds NR at cell edge)",
             "Check UE EN-DC band combination support"], "TS 36.331 5.6.13", category="endc", field="failureType-r15")


def scg_failure(res, val, facts):
    rep = find_first(val, "scg-FailureInfo-r12") or {}
    ftype = rep.get("failureType-r12")
    res["summary"] = f"UE reports dual connectivity SCG failure ({human(ftype) if ftype else 'unknown'})."
    finding(res, "critical", "SCG failure (LTE-DC)", f"Failure type {ftype}.", category="radio")


def ue_information_response(res, val, facts):
    rlf = find_first(val, "rlf-Report-r9")
    if isinstance(rlf, dict):
        last = _lte_meas(rlf.get("measResultLastServCell-r9"))
        ftype = find_first(rlf, "connectionFailureType-r10")
        cause = find_first(rlf, "rlf-Cause-r11")
        tconn = find_first(rlf, "timeConnFailure-r10")
        fpc = find_first(rlf, "failedPCellId-r10")
        pci = None
        if choice(fpc) == "pci-arfcn-r10":
            pci = fpc[1].get("physCellId-r10")
        hl(res, "Failure type", ftype, "rlf = radio link failure, hof = handover failure")
        hl(res, "RLF cause", cause, RLF_CAUSES.get(cause))
        hl(res, "Last serving", _fmt_meas(last))
        hl(res, "Failed PCell PCI", pci)
        hl(res, "Time since connection", f"{tconn * 100} ms" if isinstance(tconn, int) else None,
           "Short time points to a too-early handover")
        res["summary"] = f"UE delivers a radio link failure report ({ftype or 'rlf'}, {RLF_CAUSES.get(cause, cause or 'cause n/a')})."
        finding(res, "critical", "Radio link failure report", f"Connection failure type {ftype or 'rlf'}"
                + (f", cause: {RLF_CAUSES.get(cause, cause)}" if cause else "") + (f". Last serving {_fmt_meas(last)}." if last else "."),
                ["Coverage hole", "Late or wrong handover", "Uplink power limitation"],
                ["Correlate with handover parameters and neighbour list", "Use MRO (mobility robustness) analysis"],
                "TS 36.331 5.6.5", category="radio", field="rlf-Report-r9")
    else:
        res["summary"] = "UE answers the UE Information Request."


def ue_assistance(res, val, facts):
    oh = find_first(val, "overheatingAssistance-r14")
    ppi = find_first(val, "powerPrefIndication-r11")
    hl(res, "Power preference", ppi)
    if oh is not None:
        finding(res, "warning", "UE reports overheating", "The UE asks the network to reduce CA / MIMO / bandwidth to cool down. Throughput will drop.",
                ["Device thermal limit reached (high UL power, many CCs, high ambient temperature)"],
                ["Check device temperature logs", "Check the reduced UE category / CCs requested"], category="device")
    res["summary"] = "UE sends assistance information" + (" reporting overheating." if oh is not None else ".")


def mobility_from_eutra(res, val, facts):
    purpose = find_first(val, "purpose")
    kind = choice(purpose)
    csfb = find_first(val, "cs-FallbackIndicator")
    target = None
    if kind == "handover":
        target = purpose[1].get("targetRAT-Type")
    elif kind == "cellChangeOrder":
        target = "GERAN"
    elif kind == "e-CSFB-r9":
        target = "CDMA2000 1xRTT"
    hl(res, "Purpose", kind)
    hl(res, "Target RAT", target)
    hl(res, "CS fallback", "yes" if csfb else "no")
    res["summary"] = f"eNB orders {'an inter-RAT handover' if kind == 'handover' else 'a cell change'} to {target}" + (" for CS fallback." if csfb else ".")
    finding(res, "info", "Leaving LTE", f"UE is moved to {target}" + (" because of CS fallback (voice without VoLTE)." if csfb else "."),
            category="mobility")


def counter_check(res, val, facts):
    res["summary"] = "eNB checks PDCP COUNT values per DRB (security check against packet insertion)."


HANDLERS = {
    "measurementReport": measurement_report,
    "rrcConnectionRequest": rrc_connection_request,
    "rrcConnectionSetup": rrc_connection_setup,
    "rrcConnectionSetupComplete": rrc_connection_setup_complete,
    "rrcConnectionReject": rrc_connection_reject,
    "rrcConnectionRelease": rrc_connection_release,
    "rrcConnectionReconfiguration": rrc_connection_reconfiguration,
    "RRCConnectionReconfiguration": rrc_connection_reconfiguration,
    "rrcConnectionReconfigurationComplete": reconfiguration_complete,
    "rrcConnectionReestablishmentRequest": reestablishment_request,
    "rrcConnectionReestablishment": reestablishment,
    "rrcConnectionReestablishmentComplete": reestablishment_complete,
    "rrcConnectionReestablishmentReject": reestablishment_reject,
    "securityModeCommand": security_mode_command,
    "securityModeComplete": security_mode_complete,
    "securityModeFailure": security_mode_failure,
    "ueCapabilityEnquiry": ue_capability_enquiry,
    "ueCapabilityInformation": ue_capability_information,
    "ulInformationTransfer": information_transfer,
    "dlInformationTransfer": information_transfer,
    "masterInformationBlock": mib,
    "systemInformationBlockType1": sib1,
    "systemInformation": system_information,
    "paging": paging,
    "scgFailureInformationNR": scg_failure_nr,
    "scgFailureInformation": scg_failure,
    "ueInformationResponse": ue_information_response,
    "ueAssistanceInformation": ue_assistance,
    "mobilityFromEUTRACommand": mobility_from_eutra,
    "counterCheck": counter_check,
}
