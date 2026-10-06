"""Walk pycrate_core NAS elements (TS 24.301 / 24.501 / 24.008) into nodes.

T/L wrappers (Type1V, Type4TLV, Type6LVE ...) are collapsed so every node is
an information element with its decoded content.
"""

import re

from .labels import pretty

_WRAPPERS = {"Type1V", "Type1TV", "Type2", "Type3V", "Type3TV", "Type4LV", "Type4TLV",
             "Type6LVE", "Type6TLVE", "Type7"}
_SKIP_ATOMS = {"T", "L", "IEI"}

# Message type -> direction for EPS / 5GS NAS (TS 24.301 9.8, TS 24.501 9.7)
EMM_DIR = {
    0x41: "UL", 0x42: "DL", 0x43: "UL", 0x44: "DL", 0x45: "BOTH", 0x46: "BOTH", 0x48: "UL",
    0x49: "DL", 0x4A: "UL", 0x4B: "DL", 0x4C: "UL", 0x4D: "UL", 0x4E: "DL", 0x4F: "DL",
    0x50: "DL", 0x51: "UL", 0x52: "DL", 0x53: "UL", 0x54: "DL", 0x55: "DL", 0x56: "UL",
    0x5C: "UL", 0x5D: "DL", 0x5E: "UL", 0x5F: "UL", 0x60: "BOTH", 0x61: "DL", 0x62: "DL",
    0x63: "UL", 0x64: "DL", 0x68: "DL", 0x69: "UL",
}
ESM_DIR = {
    0xC1: "DL", 0xC2: "UL", 0xC3: "UL", 0xC5: "DL", 0xC6: "UL", 0xC7: "UL", 0xC9: "DL",
    0xCA: "UL", 0xCB: "UL", 0xCD: "DL", 0xCE: "UL", 0xCF: "UL", 0xD0: "UL", 0xD1: "DL",
    0xD2: "UL", 0xD3: "DL", 0xD4: "UL", 0xD5: "DL", 0xD6: "UL", 0xD7: "DL", 0xD9: "DL",
    0xDA: "UL", 0xDB: "DL", 0xE8: "BOTH", 0xE9: "UL", 0xEA: "DL", 0xEB: "UL", 0xEC: "DL",
    0xEF: "BOTH",
}
FGMM_DIR = {
    0x41: "UL", 0x42: "DL", 0x43: "UL", 0x44: "DL", 0x45: "UL", 0x46: "DL", 0x47: "DL",
    0x48: "UL", 0x4C: "UL", 0x4D: "DL", 0x4E: "DL", 0x4F: "UL", 0x50: "DL", 0x51: "UL",
    0x52: "DL", 0x54: "DL", 0x55: "UL", 0x56: "DL", 0x57: "UL", 0x58: "DL", 0x59: "UL",
    0x5A: "DL", 0x5B: "DL", 0x5C: "UL", 0x5D: "DL", 0x5E: "UL", 0x5F: "UL", 0x64: "BOTH",
    0x65: "DL", 0x66: "UL", 0x67: "UL", 0x68: "DL", 0x69: "DL", 0x6A: "UL",
}
FGSM_DIR = {
    0xC1: "UL", 0xC2: "DL", 0xC3: "DL", 0xC5: "DL", 0xC6: "UL", 0xC7: "DL", 0xC9: "UL",
    0xCA: "DL", 0xCB: "DL", 0xCC: "UL", 0xCD: "UL", 0xD1: "UL", 0xD2: "DL", 0xD3: "DL",
    0xD4: "UL", 0xD6: "BOTH",
}

_ACRONYMS = {"pdu", "pdn", "eps", "emm", "esm", "nas", "gmm", "gprs", "guti", "imsi", "ims",
             "ue", "5gmm", "5gsm", "5gs", "cs", "ps", "sms", "tau", "rrc", "ussd", "mm", "cc",
             "ss", "sm", "rr", "lcs", "cp", "ul", "dl", "sor", "ssc", "lpp", "pti", "tmsi",
             "mbms", "id", "nssai", "dnn", "apn", "qos", "dtmf", "tft", "plmn", "eap"}


def title_case(text):
    words = []
    for w in text.replace("_", " ").split():
        low = w.lower()
        if low in _ACRONYMS:
            words.append(w.upper() if low not in ("5gmm", "5gsm", "5gs") else w.upper())
        else:
            words.append(w[:1].upper() + w[1:])
    return " ".join(words)


def _atom_label(elt, val):
    dic = getattr(elt, "_dic", None)
    if dic is None:
        return None
    try:
        if callable(dic):
            return dic(val)
        return dic.get(val)
    except Exception:
        return None


def _fmt_decode(name, res):
    """Format the output of pycrate IE .decode() helpers."""
    if res is None:
        return None
    if isinstance(res, str):
        return res
    if isinstance(res, tuple):
        parts = []
        for p in res:
            if isinstance(p, (bytes, bytearray)):
                parts.append(p.hex().upper())
            elif isinstance(p, tuple):
                parts.append(_fmt_decode(name, p))
            else:
                parts.append(str(p))
        return ", ".join(x for x in parts if x)
    if isinstance(res, list):
        return "; ".join(_fmt_decode(name, r) or "" for r in res)
    return str(res)


_ID_TYPES_EPS = {1: "IMSI", 3: "IMEI", 6: "GUTI"}
_ID_TYPES_5GS = {1: "SUCI", 2: "5G-GUTI", 3: "IMEI", 4: "5G-S-TMSI", 5: "IMEISV", 6: "MAC address", 7: "EUI-64"}
_ID_TYPES_2G = {1: "IMSI", 2: "IMEI", 3: "IMEISV", 4: "TMSI/P-TMSI", 5: "TMGI"}


def _identity_hint(elt):
    """Readable identity for EPSID / FGSID / ID elements."""
    try:
        res = elt.decode()
    except Exception:
        return None, None
    cls = type(elt).__name__
    table = {"EPSID": _ID_TYPES_EPS, "FGSID": _ID_TYPES_5GS}.get(cls, _ID_TYPES_2G)
    if isinstance(res, tuple) and res and isinstance(res[0], int):
        kind = table.get(res[0], f"type {res[0]}")
        rest = res[1:]
        d = rest[0] if len(rest) == 1 and isinstance(rest[0], dict) else None
        if d is not None:
            if "5GTMSI" in d and "AMFRegionID" in d:
                return (f"5G-GUTI: PLMN {d.get('PLMN')}, AMF Region {d.get('AMFRegionID')}, AMF Set {d.get('AMFSetID')}, "
                        f"AMF Pointer {d.get('AMFPtr')}, 5G-TMSI 0x{int(d['5GTMSI']):08X}"), "guti"
            if "5GTMSI" in d:
                return (f"5G-S-TMSI: AMF Set {d.get('AMFSetID')}, AMF Pointer {d.get('AMFPtr')}, "
                        f"5G-TMSI 0x{int(d['5GTMSI']):08X}"), "tmsi"
            return f"{kind} " + ", ".join(f"{a} {b}" for a, b in d.items()), "identity"
        if kind == "IMSI" and rest and isinstance(rest[0], str):
            return f"IMSI {rest[0]}", "imsi"
        if kind in ("IMEI", "IMEISV") and rest:
            return f"{kind} {rest[0]}", "imei"
        if kind == "GUTI" and rest:
            # (plmn, mmegi, mmec, mtmsi)
            r = rest[0] if len(rest) == 1 and isinstance(rest[0], tuple) else rest
            try:
                plmn, mmegi, mmec, mtmsi = r
                return f"GUTI: PLMN {plmn}, MMEGI {mmegi}, MMEC {mmec}, M-TMSI 0x{mtmsi:08X}", "guti"
            except Exception:
                return f"GUTI {_fmt_decode(cls, rest)}", "guti"
        if kind == "5G-GUTI" and rest:
            r = rest[0] if len(rest) == 1 and isinstance(rest[0], tuple) else rest
            try:
                plmn, amfrid, amfsid, amfptr, tmsi = r
                return (f"5G-GUTI: PLMN {plmn}, AMF Region {amfrid}, AMF Set {amfsid}, "
                        f"AMF Pointer {amfptr}, 5G-TMSI 0x{tmsi:08X}"), "guti"
            except Exception:
                return f"5G-GUTI {_fmt_decode(cls, rest)}", "guti"
        if kind == "5G-S-TMSI" and rest:
            r = rest[0] if len(rest) == 1 and isinstance(rest[0], tuple) else rest
            try:
                amfsid, amfptr, tmsi = r
                return f"5G-S-TMSI: AMF Set {amfsid}, AMF Pointer {amfptr}, 5G-TMSI 0x{tmsi:08X}", "tmsi"
            except Exception:
                return f"5G-S-TMSI {_fmt_decode(cls, rest)}", "tmsi"
        if kind == "SUCI" and rest:
            return f"SUCI {_fmt_decode(cls, rest)}", "suci"
        if kind.startswith("TMSI"):
            v = rest[0] if rest else None
            if isinstance(v, int):
                return f"TMSI/P-TMSI 0x{v:08X}", "tmsi"
        return f"{kind} {_fmt_decode(cls, rest)}", "identity"
    return _fmt_decode(cls, res), "identity"


def _kid(node, key):
    for c in node.get("c") or []:
        if c.get("k") == key:
            return c
    return None


def _hexbytes(v):
    try:
        return bytes.fromhex((v or "").replace(" ", "").split("…")[0])
    except ValueError:
        return b""


def _ipv4(b):
    return ".".join(str(x) for x in b) if len(b) == 4 else None


def _iid(b):
    if len(b) != 8:
        return None
    return "::" + ":".join(f"{int.from_bytes(b[i:i + 2], 'big'):x}" for i in range(0, 8, 2))


def _labels_to_name(b):
    """APN / DNN label encoding (length-prefixed labels) -> dotted name."""
    out, i = [], 0
    while i < len(b):
        n = b[i]
        out.append(b[i + 1:i + 1 + n].decode("ascii", "replace"))
        i += 1 + n
    return ".".join(out)


def _secs_from_label(label, value):
    import re as _re
    if not label:
        return None
    low = str(label).lower()
    if "deactivated" in low:
        return -1
    m = _re.match(r"(\d+)\s*(sec|s|min|hr|hour|h)", low)
    if not m:
        return None
    mult = {"sec": 1, "s": 1, "min": 60, "hr": 3600, "hour": 3600, "h": 3600}[m.group(2)]
    return int(m.group(1)) * mult * value


def _fmt_secs(s):
    if s is None:
        return None
    if s < 0:
        return "deactivated"
    if s == 0:
        return "0 (stopped)"
    if s < 120:
        return f"{s} s"
    if s < 7200:
        return f"{s / 60:g} min"
    return f"{s / 3600:g} h"


_SST = {1: "eMBB", 2: "URLLC", 3: "MIoT", 4: "V2X", 5: "HMTC"}


def _snssai_text(node):
    sst = _kid(node, "SST")
    sd = _kid(node, "SD")
    if sst is None:
        return None
    try:
        v = int(sst.get("v"))
    except (TypeError, ValueError):
        return None
    t = f"SST {v}" + (f" ({_SST[v]})" if v in _SST else "")
    if sd is not None and sd.get("v"):
        t += f", SD {sd['v'].replace(' ', '')}"
    return t


def ie_hint(node):
    """Readable value for well known IE envelopes. Mutates node (h / num)."""
    cls = node.get("t")
    k = node.get("k")
    try:
        if cls in ("PDNAddr", "PDUAddress"):
            typ = _kid(node, "Type")
            addr = _hexbytes((_kid(node, "Addr") or {}).get("v"))
            t = int(typ["v"]) if typ else None
            if t == 1:
                node["h"] = _ipv4(addr[:4]) or None
            elif t == 2:
                node["h"] = f"IPv6 interface ID {_iid(addr[:8])}"
            elif t == 3:
                node["h"] = f"{_ipv4(addr[8:12])} and IPv6 interface ID {_iid(addr[:8])}"
            if node.get("h") is None:
                node.pop("h", None)
        elif cls in ("APN", "DNN") or k in ("APN", "DNN"):
            vals = []
            for item in node.get("c") or []:
                v = _kid(item, "Value")
                if v is not None and v.get("h"):
                    vals.append(v["h"].strip('"'))
            if vals:
                node["h"] = ".".join(vals)
        elif cls in ("GPRSTimer", "GPRSTimer2", "GPRSTimer3"):
            unit, value = _kid(node, "Unit"), _kid(node, "Value")
            if unit and value:
                s = _secs_from_label(unit.get("h"), int(value["v"]))
                if s is not None:
                    node["h"] = _fmt_secs(s)
                    node["num"] = s
        elif cls in ("SessAMBR", "APN_AMBR", "APNAMBR"):
            dl, ul = _kid(node, "DL"), _kid(node, "UL")
            dlu, ulu = _kid(node, "DLUnit"), _kid(node, "ULUnit")
            if dl and dlu and ul and ulu:
                node["h"] = f"DL {dl['v']} x {dlu.get('h', dlu['v'])}, UL {ul['v']} x {ulu.get('h', ulu['v'])}"
        elif cls == "SNSSAI":
            t = _snssai_text(node)
            if t:
                node["h"] = t
        elif cls == "NSSAI":
            items = []
            for item in node.get("c") or []:
                sn = _kid(item, "SNSSAI") or item
                t = _snssai_text(sn)
                if t:
                    items.append(t)
            if items:
                node["h"] = "; ".join(items)
        elif cls in ("TAIList", "5GSTAIList", "FGSTAIList"):
            out = []
            for part in node.get("c") or []:
                ptai = _kid(part, "PTAI") or part
                plmn = _kid(ptai, "PLMN")
                tacs = _kid(ptai, "TACs") or _kid(ptai, "TAC")
                p = plmn.get("h") if plmn else None
                vals = [c.get("v") for c in (tacs.get("c") or [])] if tacs and tacs.get("c") else ([tacs.get("v")] if tacs else [])
                if p:
                    out.append(f"{p.split(',')[0]}: TAC {', '.join(str(v) for v in vals if v is not None)}")
            if out:
                node["h"] = "; ".join(out)
    except Exception:
        pass
    return node


class NasWalker:
    def __init__(self):
        self.nested = []  # inner NAS messages found (for the flow / procedures)

    def walk(self, elt, name=None):
        return self._walk(elt, name or elt._name)

    def _walk(self, elt, name, parent=None):
        cls = type(elt).__name__
        klass = elt.CLASS
        if klass == "Envelope":
            kids = [c for c in elt if not c.get_trans()]
            if cls in _WRAPPERS:
                inner = [c for c in kids if c._name not in _SKIP_ATOMS]
                if len(inner) == 1:
                    node = self._walk(inner[0], name)
                    node["k"] = name
                    node["l"] = pretty_ie(name)
                    return node
                node = {"k": name, "l": pretty_ie(name), "c": [self._walk(c, c._name) for c in inner]}
                return node
            if _is_message(elt):
                # embedded NAS message (ESM container, payload container, inner sec-protected msg)
                return self._message_node(elt, name)
            node = {"k": name, "l": pretty_ie(name), "t": cls}
            if cls in ("EPSID", "FGSID", "ID"):
                h, tag = _identity_hint(elt)
                if h:
                    node["h"] = h
                    node["tag"] = tag
            elif hasattr(elt, "decode") and cls not in ("EPSID", "FGSID", "ID"):
                try:
                    h = _fmt_decode(cls, elt.decode())
                    if h:
                        node["h"] = h
                except Exception:
                    pass
            node["c"] = [self._walk(c, c._name, name) for c in kids]
            if "h" not in node:
                ie_hint(node)
            return node
        if klass in ("Array", "Sequence"):
            items = [c for c in elt if not c.get_trans()]
            node = {"k": name, "l": pretty_ie(name), "t": cls, "n": len(items)}
            node["c"] = []
            for i, c in enumerate(items):
                sub = self._walk(c, c._name)
                sub["k"] = f"[{i}]"
                sub["l"] = f"#{i + 1}"
                node["c"].append(sub)
            ie_hint(node)
            return node
        if klass == "Alt":
            try:
                alt = elt.get_alt()
            except Exception:
                alt = None
            if alt is None:
                return {"k": name, "l": pretty_ie(name), "v": "absent"}
            node = self._walk(alt, name)
            return node
        # Atom
        val = elt.get_val()
        node = {"k": name, "l": pretty_ie(name, parent), "t": cls}
        if isinstance(val, (bytes, bytearray)):
            b = bytes(val)
            node["v"] = " ".join(f"{x:02X}" for x in b[:48]) + (f" … ({len(b)} bytes)" if len(b) > 48 else "")
            if len(b) > 48:
                node["x"] = b.hex().upper()
            if cls == "PLMN" and len(b) == 3:
                from .radio import plmn_from_bytes, plmn_text
                mcc, mnc = plmn_from_bytes(b)
                node["h"] = f"{mcc}-{mnc}, " + (plmn_text(mcc, mnc) or "").split(", ", 1)[-1]
                node["tag"] = "plmn"
            elif name in ("DNN", "APN") and b and b[0] < len(b):
                node["h"] = _labels_to_name(b)
            elif b and all(32 <= x < 127 for x in b) and len(b) > 2:
                node["h"] = f'"{b.decode("ascii")}"'
        else:
            node["v"] = str(val)
            lab = _atom_label(elt, val)
            if lab is not None and str(lab) != str(val):
                node["h"] = str(lab)
            elif name in ("5GTMSI", "MTMSI", "M-TMSI", "TMSI", "PTMSI") and isinstance(val, int):
                node["h"] = f"0x{val:08X}"
            elif isinstance(val, str) and name in ("DNN", "APN"):
                node["h"] = val
        return node

    def _message_node(self, msg, name):
        info = message_info(msg)
        node = {"k": name, "l": pretty_ie(name), "t": msg._name or type(msg).__name__,
                "v": info["title"], "c": [self._walk(c, c._name, c._name) for c in msg if not c.get_trans()]}
        node["tag"] = "nas-message"
        self.nested.append(msg)
        return node


def _is_message(elt):
    first = None
    for c in elt:
        first = c
        break
    if first is None:
        return False
    return first._name in ("EMMHeader", "ESMHeader", "5GMMHeader", "5GSMHeader", "EMMHeaderSec",
                           "5GMMHeaderSec", "MMHeader", "CCHeader", "GMMHeader", "SMHeader",
                           "RRHeader", "SSHeader", "CPHeader", "EMMHeaderServ")


_ALGO_RE = re.compile(r"^(5G-)?(EEA|EIA|EA|IA)(\d)(_128)?$")


def pretty_ie(name, parent=None):
    if not name:
        return name
    m = _ALGO_RE.match(name)
    if m:
        pre = "5G-" if m.group(1) else ""
        return f"{'128-' if m.group(4) else ''}{pre}{m.group(2)}{m.group(3)}"
    if name == "Type":
        return "Message Type" if parent and parent.endswith("Header") else "Type"
    if name.startswith("[") or name in ("V",):
        return name
    if name in ("SecHdr",):
        return "Security Header Type"
    special = {"EPSID": "EPS Mobile Identity", "UENetCap": "UE Network Capability",
               "ESMContainer": "ESM Message Container", "NAS_KSI": "NAS Key Set Identifier",
               "EPSAttachType": "EPS Attach Type", "EMMCause": "EMM Cause", "ESMCause": "ESM Cause",
               "5GMMCause": "5GMM Cause", "5GSMCause": "5GSM Cause", "SecHdr": "Security Header Type",
               "ProtDisc": "Protocol Discriminator", "EPD": "Extended Protocol Discriminator",
               "Type": "Message Type", "PTI": "Procedure Transaction Identity",
               "EPSBearerId": "EPS Bearer Identity", "PSI": "PDU Session ID",
               "PDUSessID": "PDU Session ID", "NASKSI": "ngKSI", "NAS_KSI": "NAS Key Set Identifier",
               "5GSID": "5GS Mobile Identity", "5GSRegType": "5GS Registration Type",
               "UESecCap": "UE Security Capability", "TAIList": "TAI List",
               "T3412": "T3412 Periodic TAU Timer", "T3412Ext": "T3412 Extended Value",
               "T3402": "T3402 Timer", "T3423": "T3423 Timer", "T3512": "T3512 Periodic Registration Timer",
               "T3502": "T3502 Timer", "T3346": "T3346 Back-off Timer", "T3396": "T3396 Back-off Timer",
               "MAC": "Message Authentication Code", "Seqn": "Sequence Number",
               "NASMessage": "NAS Message", "APN": "Access Point Name", "DNN": "DNN",
               "PDNAddr": "PDN Address", "PDNType": "PDN Type", "RequestType": "Request Type",
               "EPSQoS": "EPS QoS", "APN_AMBR": "APN-AMBR", "ProtConfig": "Protocol Configuration Options",
               "ExtProtConfig": "Extended Protocol Configuration Options", "GUTI": "GUTI",
               "EPSNetFeat": "EPS Network Feature Support", "5GSNetFeat": "5GS Network Feature Support",
               "AllowedNSSAI": "Allowed NSSAI", "RejectedNSSAI": "Rejected NSSAI",
               "ConfiguredNSSAI": "Configured NSSAI", "RequestedNSSAI": "Requested NSSAI",
               "PayloadContainer": "Payload Container", "PayloadContainerType": "Payload Container Type",
               "RAND": "Authentication RAND", "AUTN": "Authentication AUTN", "RES": "Authentication RES",
               "AUTS": "Authentication Failure Parameter (AUTS)", "IMEISVReq": "IMEISV Request",
               "NASSecAlgo": "Selected NAS Security Algorithms", "UENetCap": "UE Network Capability",
               "MSNetCap": "MS Network Capability", "DRXParam": "DRX Parameter",
               "EPSUpdateType": "EPS Update Type", "EPSUpdateResult": "EPS Update Result",
               "EPSAttachResult": "EPS Attach Result", "LAI": "Location Area Identification",
               "MSIdentity": "MS Identity", "EmergNumList": "Emergency Number List",
               "SSC_Mode": "SSC Mode", "SSCMode": "SSC Mode", "PDUSessType": "PDU Session Type",
               "SessAMBR": "Session-AMBR", "QoSRules": "QoS Rules", "QoSFlowDesc": "QoS Flow Descriptions",
               "SNSSAI": "S-NSSAI", "BackOffTimer": "Back-off Timer", "EAPMsg": "EAP Message",
               "ABBA": "ABBA", "ngKSI": "ngKSI", "NgKSI": "ngKSI", "TACs": "TACs", "TAC": "TAC",
               "MTMSI": "M-TMSI", "5GTMSI": "5G-TMSI", "PTAI": "Partial TAI List", "MMEGI": "MME Group ID",
               "MMEC": "MME Code", "AMFRegionID": "AMF Region ID", "AMFSetID": "AMF Set ID", "AMFPtr": "AMF Pointer"}
    if name in special:
        return special[name]
    if name.startswith("5G"):
        return "5G" + (" " + pretty(name[2:]) if name[2:] else "")
    return pretty(name.replace("_", "-"))


def message_info(msg):
    """Identify a pycrate NAS message: protocol, type code, title, direction."""
    first = None
    for c in msg:
        first = c
        break
    hname = first._name if first is not None else ""
    cls = msg._name or type(msg).__name__
    proto, family, mtype, title, direction = "NAS", "NAS", None, None, None
    sec = None
    try:
        if hname in ("EMMHeaderSec", "5GMMHeaderSec"):
            sec = first["SecHdr"].get_val()
            label = _atom_label(first["SecHdr"], sec)
            fam = "EPS NAS" if hname == "EMMHeaderSec" else "5GS NAS"
            return {"family": fam, "proto": "EMM" if fam == "EPS NAS" else "5GMM", "type": None,
                    "title": "Security Protected NAS Message", "direction": None, "sec": sec,
                    "secLabel": label, "cls": cls}
        if hname == "EMMHeaderServ":
            return {"family": "EPS NAS", "proto": "EMM", "type": 0x4D, "title": "Service Request",
                    "direction": "UL", "sec": 12, "cls": cls}
        tf = first["Type"]
        mtype = tf.get_val()
        label = _atom_label(tf, mtype)
        title = title_case(str(label)) if label else pretty(cls)
        if hname == "EMMHeader":
            family, proto = "EPS NAS", "EMM"
            direction = EMM_DIR.get(mtype)
        elif hname == "ESMHeader":
            family, proto = "EPS NAS", "ESM"
            direction = ESM_DIR.get(mtype)
        elif hname == "5GMMHeader":
            family, proto = "5GS NAS", "5GMM"
            direction = FGMM_DIR.get(mtype)
        elif hname == "5GSMHeader":
            family, proto = "5GS NAS", "5GSM"
            direction = FGSM_DIR.get(mtype)
        else:
            family = "2G/3G NAS"
            proto = hname.replace("Header", "") or "NAS"
    except Exception:
        title = pretty(cls)
    if direction == "BOTH":
        direction = None
    return {"family": family, "proto": proto, "type": mtype, "title": title,
            "direction": direction, "sec": sec, "cls": cls}
