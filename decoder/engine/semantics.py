"""Physical meaning for ASN.1 leaves, keyed on the spec type name.

Each decorator returns a dict that the tree walker merges into the node:
  h    readable interpretation ("-95 dBm", "Band 3 FDD, DL 1815 MHz")
  tag  semantic tag used by the UI and the insight rules ("rsrp", "pci", ...)
  q    quality bucket for measurements ("good", "poor", ...)
  num  numeric physical value (for charts)
"""

from . import radio


def _family(module):
    if not module:
        return "other"
    if module.startswith("EUTRA") or module.startswith("NBIOT"):
        return "lte"
    if module.startswith("NR"):
        return "nr"
    return "other"


def _bits_int(v):
    if isinstance(v, tuple) and len(v) == 2 and isinstance(v[0], int):
        return v
    return None, None


def _meas(tag, fn, idx):
    num, text = fn(idx)
    if tag == "rsrp":
        q = radio.quality_rsrp(num)
    elif tag == "rsrq":
        q = radio.quality_rsrq(num)
    else:
        q = radio.quality_sinr(num)
    return {"h": f"{text}, {radio.QUALITY_TEXT[q]}", "tag": tag, "q": q, "num": num}


def decorate_leaf(module, typename, field, value):
    fam = _family(module)
    t = typename or ""
    f = field or ""
    uplink = f.startswith("ul-") or "UL" in f[:4]

    # ---- identities and cells ------------------------------------------
    if t == "PhysCellId" or f in ("physCellId", "pci"):
        if isinstance(value, int):
            return {"h": f"PCI {value}", "tag": "pci", "num": value}
    if t.startswith("ARFCN-ValueEUTRA") or (fam == "lte" and f in ("dl-CarrierFreq", "carrierFreq") and isinstance(value, int)):
        if isinstance(value, int):
            txt = radio.earfcn_text(value, uplink)
            return {"h": f"EARFCN {value}" + (f", {txt}" if txt else ""), "tag": "earfcn", "num": value}
    if t.startswith("ARFCN-ValueNR") or f in ("absoluteFrequencySSB", "absoluteFrequencyPointA", "ssbFrequency"):
        if isinstance(value, int):
            txt = radio.nrarfcn_text(value, uplink)
            return {"h": f"NR-ARFCN {value}" + (f", {txt}" if txt else ""), "tag": "nrarfcn", "num": value}
    if t in ("FreqBandIndicator", "FreqBandIndicator-r11", "FreqBandIndicator-v9e0"):
        if isinstance(value, int):
            return {"h": f"E-UTRA band {value}", "tag": "band", "num": value}
    if t == "FreqBandIndicatorNR":
        if isinstance(value, int):
            return {"h": f"NR band n{value}", "tag": "band", "num": value}
    if t == "TrackingAreaCode" or f in ("trackingAreaCode", "trackingAreaCode-r15"):
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"TAC {v} (0x{v:0{max(1, n // 4)}X})", "tag": "tac", "num": v}
    if t in ("CellIdentity", "CellIdentity-r15", "CellIdentityNR", "CellIdentityNR-r15") or f in ("cellIdentity", "cellIdentity-r15"):
        v, n = _bits_int(value)
        if v is not None:
            if n == 28:
                return {"h": f"ECI {v} (eNB ID {v >> 8}, cell {v & 0xFF})", "tag": "cellid", "num": v}
            if n == 36:
                return {"h": f"NCI {v} (0x{v:09X}); gNB ID length is operator specific (22-32 bits)", "tag": "cellid", "num": v}
            return {"h": f"Cell identity {v}", "tag": "cellid", "num": v}
    if t in ("C-RNTI", "RNTI-Value") or f in ("c-RNTI", "newUE-Identity"):
        if isinstance(value, int):
            return {"h": f"0x{value:04X}", "tag": "rnti"}
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"0x{v:04X}", "tag": "rnti"}
    if t == "MMEC" or f == "mmec":
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"MMEC {v} (0x{v:02X})", "tag": "mmec"}
    if f == "m-TMSI":
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"M-TMSI 0x{v:08X}", "tag": "tmsi"}
    if t == "NG-5G-S-TMSI" or f in ("ng-5G-S-TMSI", "ng-5G-S-TMSI-r15"):
        v, n = _bits_int(value)
        if v is not None and n == 48:
            return {"h": f"AMF Set {v >> 38}, AMF Pointer {(v >> 32) & 0x3F}, 5G-TMSI 0x{v & 0xFFFFFFFF:08X}", "tag": "tmsi"}
    if f == "ng-5G-S-TMSI-Part1":
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"Rightmost 39 bits of 5G-S-TMSI, 5G-TMSI ends 0x{v & 0xFFFFFFFF:08X}", "tag": "tmsi"}
    if f in ("randomValue", "randomValue-r15"):
        return {"h": "UE has no S-TMSI, random value used for contention resolution", "tag": "random"}
    if t in ("I-RNTI-Value", "ShortI-RNTI-Value", "ResumeIdentity-r13", "ShortResumeIdentity-r13"):
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"0x{v:0{max(1, n // 4)}X} ({n} bits)", "tag": "irnti"}

    # ---- measurements -----------------------------------------------------
    if t in ("RSRP-Range", "RSRP-RangeSL", "RSRP-Range-v1360") or f in ("rsrpResult", "rsrp"):
        if isinstance(value, int):
            if fam == "nr":
                return _meas("rsrp", radio.nr_rsrp, value)
            if fam == "lte":
                return _meas("rsrp", radio.lte_rsrp, value)
    if t in ("RSRQ-Range", "RSRQ-Range-r13", "RSRQ-Range-v1250") or f in ("rsrqResult", "rsrq"):
        if isinstance(value, int):
            if fam == "nr":
                return _meas("rsrq", radio.nr_rsrq, value)
            if fam == "lte":
                return _meas("rsrq", radio.lte_rsrq, value)
    if t in ("SINR-Range", "RS-SINR-Range-r13") or f in ("sinr", "rs-sinr-Result-r13"):
        if isinstance(value, int):
            if fam == "nr":
                return _meas("sinr", radio.nr_sinr, value)
            if fam == "lte":
                return _meas("sinr", radio.lte_sinr, value)

    # ---- power and thresholds -------------------------------------------
    if t in ("Q-RxLevMin", "Q-RxLevMin-r9") or f in ("q-RxLevMin", "q-RxLevMinSUL"):
        if isinstance(value, int):
            return {"h": f"{value * 2} dBm minimum Rx level", "tag": "power"}
    if t in ("P-Max", "P-Max-r10") or f in ("p-Max", "p-MaxEUTRA-r15", "p-NR-FR1"):
        if isinstance(value, int):
            return {"h": f"{value} dBm max UE Tx power", "tag": "power"}
    if t in ("Q-QualMin-r9", "Q-QualMin") or f == "q-QualMin":
        if isinstance(value, int):
            return {"h": f"{value} dB minimum quality", "tag": "power"}
    if f == "referenceSignalPower" and isinstance(value, int):
        return {"h": f"{value} dBm per RE", "tag": "power"}
    if t == "Hysteresis" or f == "hysteresis":
        if isinstance(value, int):
            return {"h": f"{value * 0.5:g} dB"}
    if f in ("a3-Offset", "a6-Offset-r10", "a6-Offset") and isinstance(value, int):
        return {"h": f"{value * 0.5:g} dB offset"}
    if t == "ReselectionThreshold" or f in ("threshServingLow", "threshX-High", "threshX-Low",
                                             "s-NonIntraSearch", "s-IntraSearch", "s-IntraSearchP",
                                             "s-NonIntraSearchP"):
        if isinstance(value, int):
            return {"h": f"{value * 2} dB"}
    if f in ("systemFrameNumber",):
        v, n = _bits_int(value)
        if v is not None:
            if n == 8:
                return {"h": f"SFN {v * 4}..{v * 4 + 3} (8 MSBs of SFN)"}
            if n == 6:
                return {"h": f"SFN {v * 16}..{v * 16 + 15} (6 MSBs; 4 LSBs carried in PBCH)"}
    if f == "dl-Bandwidth" and isinstance(value, str):
        mhz = {"n6": "1.4", "n15": "3", "n25": "5", "n50": "10", "n75": "15", "n100": "20"}.get(value)
        if mhz:
            return {"h": f"{value[1:]} RB ({mhz} MHz)", "tag": "bandwidth"}
    if f in ("ul-Bandwidth", "allowedMeasBandwidth") and isinstance(value, str):
        mhz = {"n6": "1.4", "n15": "3", "n25": "5", "n50": "10", "n75": "15", "n100": "20",
               "mbw6": "1.4", "mbw15": "3", "mbw25": "5", "mbw50": "10", "mbw75": "15",
               "mbw100": "20"}.get(value)
        if mhz:
            return {"h": f"{mhz} MHz", "tag": "bandwidth"}
    if f == "carrierBandwidth" and isinstance(value, int):
        return {"h": f"{value} PRBs", "tag": "bandwidth"}
    if f in ("subCarrierSpacingCommon",) and isinstance(value, str):
        return {"h": {"scs15or60": "15 kHz (FR1) or 60 kHz (FR2)",
                      "scs30or120": "30 kHz (FR1) or 120 kHz (FR2)"}.get(value, value)}
    if f == "ssb-PositionsInBurst" or f in ("shortBitmap", "mediumBitmap", "longBitmap"):
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"{bin(v).count('1')} of {n} SSB positions transmitted"}

    # ---- core network types (S1AP / NGAP / X2AP / XnAP) -----------------
    if t in ("PLMNidentity", "PLMNIdentity", "PLMN-Identity") and isinstance(value, (bytes, bytearray)):
        mcc, mnc = radio.plmn_from_bytes(bytes(value))
        if mcc:
            return {"h": radio.plmn_text(mcc, mnc), "tag": "plmn"}
    if t == "TAC" and isinstance(value, (bytes, bytearray)):
        v = int.from_bytes(value, "big")
        return {"h": f"TAC {v} (0x{value.hex().upper()})", "tag": "tac", "num": v}
    if t in ("EUTRANCellIdentity", "CellIdentity") and fam == "other":
        v, n = _bits_int(value)
        if v is not None and n == 28:
            return {"h": f"ECI {v} (eNB ID {v >> 8}, cell {v & 0xFF})", "tag": "cellid", "num": v}
    if t == "NRCellIdentity":
        v, n = _bits_int(value)
        if v is not None:
            return {"h": f"NCI {v} (0x{v:09X})", "tag": "cellid", "num": v}
    if t in ("ENB-UE-S1AP-ID", "MME-UE-S1AP-ID", "AMF-UE-NGAP-ID", "RAN-UE-NGAP-ID") and isinstance(value, int):
        return {"h": f"{value} (0x{value:X})", "tag": "ueid"}
    return None


def decorate_struct(module, typename, field, value):
    """Decorate constructed values such as PLMN-Identity {mcc, mnc}."""
    t = typename or ""
    if t in ("PLMN-Identity", "PLMN-Identity-r15") and isinstance(value, dict):
        mnc = value.get("mnc")
        mcc = value.get("mcc")
        if mnc is not None:
            mnc_s = "".join(str(d) for d in mnc)
            mcc_s = "".join(str(d) for d in mcc) if mcc is not None else None
            txt = radio.plmn_text(mcc_s, mnc_s)
            if mcc is None:
                txt += " (MCC same as previous PLMN in list)"
            return {"h": txt, "tag": "plmn", "plmn": (mcc_s or "") + "-" + mnc_s}
    if t in ("MCC", "MNC") and isinstance(value, list):
        return {"h": "".join(str(d) for d in value)}
    return None
