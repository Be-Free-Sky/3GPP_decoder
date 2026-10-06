"""S1AP / NGAP / X2AP / XnAP / F1AP analysis."""

from .. import radio
from ..causes import AP_RADIO_CAUSES, ESTABLISHMENT_CAUSES
from ..labels import pretty
from .common import choice, bits, hl, finding, human, embedded_titles


def _ies(val):
    """Return {ie_type_name: value} for the protocolIEs of an AP PDU."""
    out = {}
    if not (isinstance(val, tuple) and len(val) == 2):
        return out
    body = val[1]
    inner = body.get("value") if isinstance(body, dict) else None
    if not isinstance(inner, tuple):
        return out
    content = inner[1]
    for ie in (content or {}).get("protocolIEs", []) if isinstance(content, dict) else []:
        v = ie.get("value")
        if isinstance(v, tuple) and len(v) == 2:
            out[v[0]] = v[1]
    return out


def analyze(res, proto):
    val = res.get("_val")
    ies = _ies(val)
    outcome = res.get("outcome")
    name = res["message"]["name"]
    layer = proto["layer"]
    facts = res["facts"]
    facts["procedure"] = name
    hl(res, "PDU type", pretty(outcome) if outcome else None)
    for key in ("ENB-UE-S1AP-ID", "MME-UE-S1AP-ID", "AMF-UE-NGAP-ID", "RAN-UE-NGAP-ID", "GNB-CU-UE-F1AP-ID",
                "GNB-DU-UE-F1AP-ID", "UE-X2AP-ID", "NG-RANnodeUEXnAPID"):
        if key in ies and isinstance(ies[key], int):
            hl(res, key, ies[key], f"0x{ies[key]:X}", "ueid")
    tai = ies.get("TAI")
    if isinstance(tai, dict):
        mcc, mnc = radio.plmn_from_bytes(tai.get("pLMNidentity") or tai.get("pLMNIdentity") or b"")
        tac = tai.get("tAC")
        tacv = int.from_bytes(tac, "big") if isinstance(tac, (bytes, bytearray)) else None
        hl(res, "TAI", f"{mcc}-{mnc}, TAC {tacv}" if mcc else None, radio.plmn_text(mcc, mnc) if mcc else None, "tac")
    cgi = ies.get("EUTRAN-CGI")
    if isinstance(cgi, dict):
        eci = bits(cgi.get("cell-ID"))
        if eci is not None:
            hl(res, "E-UTRAN CGI", f"ECI {eci}", f"eNB ID {eci >> 8}, cell {eci & 0xFF}", "cellid")
    uli = ies.get("UserLocationInformation")
    if choice(uli) == "userLocationInformationNR":
        nr = uli[1]
        nci = bits((nr.get("nR-CGI") or {}).get("nRCellIdentity"))
        hl(res, "NR CGI", f"NCI {nci}" if nci is not None else None, tag="cellid")
    est = ies.get("RRC-Establishment-Cause") or ies.get("RRCEstablishmentCause")
    if est:
        hl(res, "RRC establishment cause", est, ESTABLISHMENT_CAUSES.get(est, human(est)))
    cause = ies.get("Cause")
    cause_txt = None
    if isinstance(cause, tuple):
        group, value = cause
        cause_txt = f"{human(group)}: {human(value)}"
        hl(res, "Cause", cause_txt, AP_RADIO_CAUSES.get(value), "cause")
        facts["apCause"] = {"group": group, "value": value}
        sev = None
        if outcome == "unsuccessfulOutcome":
            sev = "critical"
        elif value in ("radio-connection-with-ue-lost", "ho-failure-in-target-EPC-eNB-or-target-system",
                       "failure-in-radio-interface-procedure", "radio-resources-not-available", "tx2relocoverall-expiry",
                       "unknown-mme-ue-s1ap-id", "unknown-enb-ue-s1ap-id", "authentication-failure"):
            sev = "warning"
        if sev:
            finding(res, sev, f"{layer} cause: {human(value)}", AP_RADIO_CAUSES.get(value, f"Cause group {human(group)}."),
                    checks=["Correlate with the UE side RRC messages at the same time",
                            f"Check {'eNB' if layer in ('S1AP', 'X2AP') else 'gNB'} and core logs for this UE ID"],
                    category=group, field="Cause")
    if outcome == "unsuccessfulOutcome" and not cause:
        finding(res, "critical", f"{pretty(name)} failed", "The procedure ended with an unsuccessful outcome.", category="network")
    nas = embedded_titles(res)
    if nas:
        hl(res, "NAS PDU", nas[0], tag="nas")
    lead = {"initiatingMessage": "Initiating", "successfulOutcome": "Successful outcome of",
            "unsuccessfulOutcome": "Unsuccessful outcome of"}.get(outcome, "")
    s = f"{layer} {pretty(name)}"
    if outcome == "unsuccessfulOutcome":
        s = f"{layer} {pretty(name)} (failure)"
    if nas:
        s += f" carrying NAS {nas[0]}"
    if cause_txt:
        s += f", cause {cause_txt}"
    res["summary"] = s + "."
    if lead:
        res["message"]["outcome"] = outcome
