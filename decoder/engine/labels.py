"""Turn ASN.1 / NAS identifiers into readable labels.

The raw identifier is always kept next to the label so engineers can still
search the spec for it; this module only produces the friendly form.
"""

import re

# Release / version suffixes such as -r8, -r15, -v1020, -v9e0
_REL_RE = re.compile(r"-(r\d+|v\d+[a-z0-9]*)$")

# Tokens that should be rendered in a fixed case.
_FIXED = {
    "rrc": "RRC", "ue": "UE", "nas": "NAS", "plmn": "PLMN", "mcc": "MCC", "mnc": "MNC",
    "tac": "TAC", "pci": "PCI", "cqi": "CQI", "srs": "SRS", "pucch": "PUCCH", "pusch": "PUSCH",
    "pdsch": "PDSCH", "pdcch": "PDCCH", "phich": "PHICH", "pbch": "PBCH", "prach": "PRACH",
    "rach": "RACH", "drx": "DRX", "mac": "MAC", "rlc": "RLC", "pdcp": "PDCP", "srb": "SRB",
    "drb": "DRB", "eps": "EPS", "nr": "NR", "eutra": "EUTRA", "utra": "UTRA", "geran": "GERAN",
    "csi": "CSI", "rs": "RS", "ssb": "SSB", "bwp": "BWP", "sib": "SIB", "mib": "MIB",
    "si": "SI", "tdd": "TDD", "fdd": "FDD", "harq": "HARQ", "tpc": "TPC", "rnti": "RNTI",
    "tmsi": "TMSI", "mmec": "MMEC", "imsi": "IMSI", "imei": "IMEI", "imeisv": "IMEISV",
    "gummei": "GUMMEI", "guami": "GUAMI", "amf": "AMF", "mme": "MME", "cn": "CN", "ran": "RAN",
    "dl": "DL", "ul": "UL", "sr": "SR", "bsr": "BSR", "phr": "PHR", "qos": "QoS", "qci": "QCI",
    "ims": "IMS", "sms": "SMS", "cs": "CS", "ps": "PS", "ho": "HO", "rlf": "RLF", "scg": "SCG",
    "mcg": "MCG", "lte": "LTE", "wlan": "WLAN", "iot": "IoT", "nb": "NB", "mbsfn": "MBSFN",
    "mbms": "MBMS", "sc": "SC", "ptm": "PTM", "scell": "SCell", "pcell": "PCell",
    "pscell": "PSCell", "spcell": "SpCell", "dmrs": "DMRS", "ptrs": "PTRS", "trs": "TRS",
    "ta": "TA", "prb": "PRB", "rb": "RB", "scs": "SCS", "mimo": "MIMO", "ca": "CA", "dc": "DC",
    "endc": "EN-DC", "mrdc": "MR-DC", "cgi": "CGI", "tai": "TAI", "ecgi": "ECGI", "ncgi": "NCGI",
    "sinr": "SINR", "rsrp": "RSRP", "rsrq": "RSRQ", "rssi": "RSSI", "lpp": "LPP", "gnss": "GNSS",
    "pdu": "PDU", "dnn": "DNN", "apn": "APN", "nssai": "NSSAI", "snssai": "S-NSSAI", "sst": "SST",
    "sd": "SD", "id": "ID", "ids": "IDs", "arfcn": "ARFCN", "earfcn": "EARFCN", "bw": "BW",
    "cp": "CP", "ofdm": "OFDM", "pmi": "PMI", "ri": "RI", "cri": "CRI", "li": "LI",
    "tci": "TCI", "zp": "ZP", "nzp": "NZP", "im": "IM", "coreset": "CORESET", "dci": "DCI",
    "lcid": "LCID", "lch": "LCH", "sps": "SPS", "tti": "TTI", "rv": "RV", "mcs": "MCS",
    "tbs": "TBS", "ack": "ACK", "nack": "NACK", "sfn": "SFN", "rat": "RAT", "irat": "IRAT",
    "csfb": "CSFB", "srvcc": "SRVCC", "volte": "VoLTE", "vonr": "VoNR", "cdma2000": "CDMA2000",
    "hrpd": "HRPD", "xrtt": "1xRTT", "gsm": "GSM", "umts": "UMTS", "wcdma": "WCDMA",
    "ssbri": "SSBRI", "bfd": "BFD", "bfr": "BFR", "rlm": "RLM", "rrm": "RRM", "smtc": "SMTC",
    "ssc": "SSC", "upf": "UPF", "smf": "SMF", "ausf": "AUSF", "udm": "UDM", "seaf": "SEAF",
    "kasme": "KASME", "ksi": "KSI", "ngksi": "ngKSI", "sqn": "SQN", "rand": "RAND",
    "autn": "AUTN", "res": "RES", "xres": "XRES", "abba": "ABBA", "eap": "EAP", "suci": "SUCI",
    "supi": "SUPI", "pei": "PEI", "guti": "GUTI", "ladn": "LADN", "nsac": "NSAC", "mico": "MICO",
    "edrx": "eDRX", "psm": "PSM", "cag": "CAG", "snpn": "SNPN", "nid": "NID", "iab": "IAB",
    "v2x": "V2X", "sl": "SL", "nrdc": "NR-DC", "nedc": "NE-DC", "ngen": "NGEN", "rlm": "RLM",
    "dapsho": "DAPS HO", "daps": "DAPS", "cho": "CHO", "pdu": "PDU", "ip": "IP", "ipv4": "IPv4",
    "ipv6": "IPv6", "tft": "TFT", "ambr": "AMBR", "apn": "APN", "ebi": "EBI", "pti": "PTI",
    "esm": "ESM", "emm": "EMM", "gmm": "GMM", "sm": "SM", "mm": "MM", "cc": "CC",
    "fgmm": "5GMM", "fgsm": "5GSM", "5gmm": "5GMM", "5gsm": "5GSM", "5gs": "5GS", "5g": "5G",
    "s1": "S1", "x2": "X2", "xn": "Xn", "ng": "NG", "f1": "F1", "e1": "E1", "n1": "N1",
    "n2": "N2", "n3": "N3", "s1ap": "S1AP", "ngap": "NGAP", "x2ap": "X2AP", "xnap": "XnAP",
    "f1ap": "F1AP", "erab": "E-RAB", "gtp": "GTP", "teid": "TEID", "gbr": "GBR", "arp": "ARP",
    "ue-ambr": "UE-AMBR", "ecn": "ECN", "pws": "PWS", "etws": "ETWS", "cmas": "CMAS",
    "ssc": "SSC", "sul": "SUL", "nul": "NUL", "rmtc": "RMTC", "lbt": "LBT", "ce": "CE",
    "mpdcch": "MPDCCH", "npdcch": "NPDCCH", "npusch": "NPUSCH", "nprach": "NPRACH",
    "cqi-pmi": "CQI-PMI", "ack-nack": "ACK-NACK", "otdoa": "OTDOA", "ecid": "E-CID",
    "musim": "MUSIM", "redcap": "RedCap", "ntn": "NTN", "ics": "ICS", "csg": "CSG",
    "hnb": "HNB", "ntn": "NTN", "ssb-index": "SSB index", "mo": "MO", "mt": "MT", "ims": "IMS",
}

# Readable names for frequently seen messages (ASN.1 choice name -> title).
MESSAGE_TITLES = {
    # LTE RRC
    "masterInformationBlock": "Master Information Block (MIB)",
    "systemInformationBlockType1": "System Information Block Type 1 (SIB1)",
    "systemInformation": "System Information",
    "rrcConnectionRequest": "RRC Connection Request",
    "rrcConnectionSetup": "RRC Connection Setup",
    "rrcConnectionSetupComplete": "RRC Connection Setup Complete",
    "rrcConnectionReject": "RRC Connection Reject",
    "rrcConnectionRelease": "RRC Connection Release",
    "rrcConnectionReconfiguration": "RRC Connection Reconfiguration",
    "rrcConnectionReconfigurationComplete": "RRC Connection Reconfiguration Complete",
    "rrcConnectionReestablishmentRequest": "RRC Connection Re-establishment Request",
    "rrcConnectionReestablishment": "RRC Connection Re-establishment",
    "rrcConnectionReestablishmentComplete": "RRC Connection Re-establishment Complete",
    "rrcConnectionReestablishmentReject": "RRC Connection Re-establishment Reject",
    "rrcConnectionResumeRequest-r13": "RRC Connection Resume Request",
    "rrcConnectionResume-r13": "RRC Connection Resume",
    "rrcConnectionResumeComplete-r13": "RRC Connection Resume Complete",
    "securityModeCommand": "Security Mode Command",
    "securityModeComplete": "Security Mode Complete",
    "securityModeFailure": "Security Mode Failure",
    "ueCapabilityEnquiry": "UE Capability Enquiry",
    "ueCapabilityInformation": "UE Capability Information",
    "ulInformationTransfer": "UL Information Transfer",
    "dlInformationTransfer": "DL Information Transfer",
    "measurementReport": "Measurement Report",
    "mobilityFromEUTRACommand": "Mobility From EUTRA Command",
    "handoverFromEUTRAPreparationRequest": "Handover From EUTRA Preparation Request",
    "csfbParametersRequestCDMA2000": "CSFB Parameters Request CDMA2000",
    "ueInformationRequest-r9": "UE Information Request",
    "ueInformationResponse-r9": "UE Information Response",
    "counterCheck": "Counter Check",
    "counterCheckResponse": "Counter Check Response",
    "proximityIndication-r9": "Proximity Indication",
    "rnReconfiguration-r10": "RN Reconfiguration",
    "loggedMeasurementConfiguration-r10": "Logged Measurement Configuration",
    "scgFailureInformation-r12": "SCG Failure Information",
    "scgFailureInformationNR-r15": "SCG Failure Information NR",
    "ueAssistanceInformation-r11": "UE Assistance Information",
    "paging": "Paging",
    # NR RRC
    "mib": "Master Information Block (MIB)",
    "systemInformationBlockType1": "System Information Block Type 1 (SIB1)",
    "rrcSetupRequest": "RRC Setup Request",
    "rrcSetup": "RRC Setup",
    "rrcSetupComplete": "RRC Setup Complete",
    "rrcReject": "RRC Reject",
    "rrcRelease": "RRC Release",
    "rrcReconfiguration": "RRC Reconfiguration",
    "rrcReconfigurationComplete": "RRC Reconfiguration Complete",
    "rrcReestablishmentRequest": "RRC Re-establishment Request",
    "rrcReestablishment": "RRC Re-establishment",
    "rrcReestablishmentComplete": "RRC Re-establishment Complete",
    "rrcResumeRequest": "RRC Resume Request",
    "rrcResumeRequest1": "RRC Resume Request (full I-RNTI)",
    "rrcResume": "RRC Resume",
    "rrcResumeComplete": "RRC Resume Complete",
    "rrcSystemInfoRequest": "RRC System Info Request",
    "scgFailureInformation": "SCG Failure Information",
    "scgFailureInformationEUTRA": "SCG Failure Information EUTRA",
    "mcgFailureInformation-r16": "MCG Failure Information",
    "failureInformation": "Failure Information",
    "ueAssistanceInformation": "UE Assistance Information",
    "ulInformationTransferMRDC": "UL Information Transfer MR-DC",
    "dlInformationTransferMRDC-r16": "DL Information Transfer MR-DC",
    "locationMeasurementIndication": "Location Measurement Indication",
    "mobilityFromNRCommand": "Mobility From NR Command",
    "ueInformationRequest-r16": "UE Information Request",
    "ueInformationResponse-r16": "UE Information Response",
}

_ENUM_UNITS = [
    (re.compile(r"^ms(\d+)dot(\d+)$"), lambda m: f"{m.group(1)}.{m.group(2)} ms"),
    (re.compile(r"^ms(\d+)$"), lambda m: f"{m.group(1)} ms"),
    (re.compile(r"^s(\d+)$"), lambda m: f"{m.group(1)} s"),
    (re.compile(r"^min(\d+)$"), lambda m: f"{m.group(1)} min"),
    (re.compile(r"^dB(-?\d+)$"), lambda m: f"{m.group(1)} dB"),
    (re.compile(r"^dBm(-?\d+)$"), lambda m: f"{m.group(1)} dBm"),
    (re.compile(r"^dB(-?\d+)dot(\d+)$"), lambda m: f"{m.group(1)}.{m.group(2)} dB"),
    (re.compile(r"^sf(\d+)$"), lambda m: f"{m.group(1)} subframes"),
    (re.compile(r"^rf(\d+)$"), lambda m: f"{m.group(1)} radio frames"),
    (re.compile(r"^sl(\d+)$"), lambda m: f"{m.group(1)} slots"),
    (re.compile(r"^sym(\d+)$"), lambda m: f"{m.group(1)} symbols"),
    (re.compile(r"^kHz(\d+)$"), lambda m: f"{m.group(1)} kHz"),
    (re.compile(r"^mhz(\d+)$", re.I), lambda m: f"{m.group(1)} MHz"),
    (re.compile(r"^percent(\d+)$"), lambda m: f"{m.group(1)} %"),
    (re.compile(r"^n(\d+)$"), lambda m: m.group(1)),
    (re.compile(r"^mbw(\d+)$"), lambda m: f"{m.group(1)} RB"),
]


def split_release(name):
    """'rrcConnectionRequest-r8' -> ('rrcConnectionRequest', 'r8')."""
    m = _REL_RE.search(name)
    if m:
        return name[: m.start()], m.group(1)
    return name, None


def _split_camel(word):
    # Split camelCase while keeping runs of capitals together: 'measResultPCell' ->
    # ['meas', 'Result', 'PCell']; 'UECapability' -> ['UE', 'Capability'].
    parts = re.findall(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+", word)
    return parts or [word]


# Spec abbreviations expanded for readability (raw names stay visible in the UI).
_EXPAND = {"meas": "Measurement", "neigh": "Neighbour", "phys": "Physical", "freq": "Frequency",
           "resel": "Reselection", "thresh": "Threshold", "serv": "Serving", "prot": "Protection",
           "ind": "Indicator", "cfg": "Config", "req": "Request", "resp": "Response", "params": "Parameters",
           "param": "Parameter", "pref": "Preference", "cap": "Capability", "info": "Info", "num": "Number",
           "max": "Max", "min": "Min", "ext": "Extension", "sched": "Scheduling", "carr": "Carrier"}


def _fix_token(tok):
    low = tok.lower()
    if low in _FIXED:
        return _FIXED[low]
    if low in _EXPAND:
        return _EXPAND[low]
    if tok.isupper() or tok.isdigit():
        return tok
    return tok[:1].upper() + tok[1:]


def pretty(name):
    """Readable label for an ASN.1 / NAS identifier (release suffix removed)."""
    if not name:
        return name
    base, _rel = split_release(name)
    if base in MESSAGE_TITLES:
        return MESSAGE_TITLES[base]
    if name in MESSAGE_TITLES:
        return MESSAGE_TITLES[name]
    # single-letter prefixes such as m-TMSI, s-TMSI, c-RNTI keep their hyphen
    m = re.match(r"^([a-z])-([A-Z0-9][A-Za-z0-9-]*)$", base)
    if m:
        return m.group(1).upper() + "-" + m.group(2)
    out = []
    for chunk in base.split("-"):
        if not chunk:
            continue
        low = chunk.lower()
        if low in _FIXED:
            out.append(_FIXED[low])
            continue
        for tok in _split_camel(chunk):
            out.append(_fix_token(tok))
    text = " ".join(out)
    # "Type1" style suffixes read better spaced
    text = re.sub(r"\bType(\d+)\b", r"Type \1", text)
    for a, b in (("PS Cell", "PSCell"), ("P SCell", "PSCell"), ("Sp SCell", "SpCell"), ("P Cell", "PCell"),
                 ("S Cell", "SCell"), ("Sp Cell", "SpCell")):
        text = re.sub(rf"\b{a}\b", b, text)
    return text


def message_title(name):
    base, _ = split_release(name)
    return MESSAGE_TITLES.get(name) or MESSAGE_TITLES.get(base) or pretty(name)


def humanize_enum(value):
    """'ms40' -> '40 ms'; returns None when no readable form is known."""
    if not isinstance(value, str):
        return None
    for rx, fn in _ENUM_UNITS:
        m = rx.match(value)
        if m:
            return fn(m)
    if value.startswith("spare"):
        return "spare"
    if value in ("true", "false"):
        return "Yes" if value == "true" else "No"
    if value == "infinity":
        return "infinite"
    return None


def humanize_cause_token(value):
    """'mo-Signalling' -> 'MO signalling', 'radio-connection-with-ue-lost' -> readable."""
    if not isinstance(value, str):
        return str(value)
    base, _ = split_release(value)
    words = []
    for chunk in base.split("-"):
        for tok in _split_camel(chunk):
            low = tok.lower()
            words.append(_FIXED.get(low, low))
    text = " ".join(w for w in words if w)
    return text[:1].upper() + text[1:] if text else value
