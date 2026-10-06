"""Protocol catalogue: every message type the decoder can handle.

ASN.1 modules are imported lazily. In the browser build (Pyodide) the large
modules ship in separate bundles; importing one that is not loaded yet raises
ModuleUnavailable(bundle) so the host can fetch that bundle and retry.
"""

import contextlib
import importlib
import io
import sys

with contextlib.redirect_stdout(io.StringIO()):
    from pycrate_mobile import NAS  # noqa: F401  (imported here so warnings are captured)

from . import pycrate_patches

pycrate_patches.apply()


class ModuleUnavailable(Exception):
    """Raised when an ASN.1 module lives in a bundle that is not loaded yet."""

    def __init__(self, bundle, module):
        super().__init__(f"bundle:{bundle}:{module}")
        self.bundle = bundle
        self.module = module


# ASN.1 module -> bundle that contains it (browser build)
MODULE_BUNDLE = {"RRCLTE": "core", "RRCNR": "core", "S1AP": "ap", "NGAP": "ap", "X2AP": "ap", "XnAP": "ap",
                 "F1AP": "ap", "RRC3G": "extra", "LPP": "extra"}

_loaded = {}


def asn1_module(name):
    mod = _loaded.get(name)
    if mod is not None:
        return mod
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            mod = importlib.import_module(f"pycrate_asn1dir.{name}")
    except ImportError as e:
        raise ModuleUnavailable(MODULE_BUNDLE.get(name, "extra"), name) from e
    _loaded[name] = mod
    return mod


def _p(pid, family, rat, layer, channel, direction, ref, codec="uper", label=None, auto=True):
    """ref = (asn1 module, definitions module, type name) or None for NAS."""
    return {
        "id": pid, "family": family, "rat": rat, "layer": layer, "channel": channel,
        "direction": direction, "ref": ref, "codec": codec, "group": family,
        "label": label or f"{family} {channel}".strip(), "auto": auto,
    }


_LTE = "EUTRA_RRC_Definitions"
_NB = "NBIOT_RRC_Definitions"
_NR = "NR_RRC_Definitions"
_U3G = "Class_definitions"

PROTOCOLS = [
    # --- LTE RRC (TS 36.331) ---
    _p("lte-rrc.ul-ccch", "LTE RRC", "LTE", "RRC", "UL-CCCH", "UL", ("RRCLTE", _LTE, "UL_CCCH_Message")),
    _p("lte-rrc.ul-dcch", "LTE RRC", "LTE", "RRC", "UL-DCCH", "UL", ("RRCLTE", _LTE, "UL_DCCH_Message")),
    _p("lte-rrc.dl-ccch", "LTE RRC", "LTE", "RRC", "DL-CCCH", "DL", ("RRCLTE", _LTE, "DL_CCCH_Message")),
    _p("lte-rrc.dl-dcch", "LTE RRC", "LTE", "RRC", "DL-DCCH", "DL", ("RRCLTE", _LTE, "DL_DCCH_Message")),
    _p("lte-rrc.bcch-bch", "LTE RRC", "LTE", "RRC", "BCCH-BCH", "DL", ("RRCLTE", _LTE, "BCCH_BCH_Message")),
    _p("lte-rrc.bcch-dl-sch", "LTE RRC", "LTE", "RRC", "BCCH-DL-SCH", "DL", ("RRCLTE", _LTE, "BCCH_DL_SCH_Message")),
    _p("lte-rrc.pcch", "LTE RRC", "LTE", "RRC", "PCCH", "DL", ("RRCLTE", _LTE, "PCCH_Message")),
    _p("lte-rrc.mcch", "LTE RRC", "LTE", "RRC", "MCCH", "DL", ("RRCLTE", _LTE, "MCCH_Message"), auto=False),
    _p("lte-rrc.ue-eutra-capability", "LTE RRC", "LTE", "RRC", "UE-EUTRA-Capability", None,
       ("RRCLTE", _LTE, "UE_EUTRA_Capability"), auto=False, label="LTE UE-EUTRA-Capability (container)"),
    _p("lte-rrc.rrc-connection-reconfiguration", "LTE RRC", "LTE", "RRC", "RRCConnectionReconfiguration", "DL",
       ("RRCLTE", _LTE, "RRCConnectionReconfiguration"), auto=False,
       label="LTE RRCConnectionReconfiguration (container)"),
    # --- NB-IoT RRC ---
    _p("nbiot-rrc.ul-ccch", "NB-IoT RRC", "NB-IoT", "RRC", "UL-CCCH", "UL", ("RRCLTE", _NB, "UL_CCCH_Message_NB"), auto=False),
    _p("nbiot-rrc.ul-dcch", "NB-IoT RRC", "NB-IoT", "RRC", "UL-DCCH", "UL", ("RRCLTE", _NB, "UL_DCCH_Message_NB"), auto=False),
    _p("nbiot-rrc.dl-ccch", "NB-IoT RRC", "NB-IoT", "RRC", "DL-CCCH", "DL", ("RRCLTE", _NB, "DL_CCCH_Message_NB"), auto=False),
    _p("nbiot-rrc.dl-dcch", "NB-IoT RRC", "NB-IoT", "RRC", "DL-DCCH", "DL", ("RRCLTE", _NB, "DL_DCCH_Message_NB"), auto=False),
    _p("nbiot-rrc.bcch-bch", "NB-IoT RRC", "NB-IoT", "RRC", "BCCH-BCH", "DL", ("RRCLTE", _NB, "BCCH_BCH_Message_NB"), auto=False),
    _p("nbiot-rrc.bcch-dl-sch", "NB-IoT RRC", "NB-IoT", "RRC", "BCCH-DL-SCH", "DL", ("RRCLTE", _NB, "BCCH_DL_SCH_Message_NB"),
       auto=False),
    _p("nbiot-rrc.pcch", "NB-IoT RRC", "NB-IoT", "RRC", "PCCH", "DL", ("RRCLTE", _NB, "PCCH_Message_NB"), auto=False),
    # --- NR RRC (TS 38.331) ---
    _p("nr-rrc.ul-ccch", "NR RRC", "NR", "RRC", "UL-CCCH", "UL", ("RRCNR", _NR, "UL_CCCH_Message")),
    _p("nr-rrc.ul-ccch1", "NR RRC", "NR", "RRC", "UL-CCCH1", "UL", ("RRCNR", _NR, "UL_CCCH1_Message")),
    _p("nr-rrc.ul-dcch", "NR RRC", "NR", "RRC", "UL-DCCH", "UL", ("RRCNR", _NR, "UL_DCCH_Message")),
    _p("nr-rrc.dl-ccch", "NR RRC", "NR", "RRC", "DL-CCCH", "DL", ("RRCNR", _NR, "DL_CCCH_Message")),
    _p("nr-rrc.dl-dcch", "NR RRC", "NR", "RRC", "DL-DCCH", "DL", ("RRCNR", _NR, "DL_DCCH_Message")),
    _p("nr-rrc.bcch-bch", "NR RRC", "NR", "RRC", "BCCH-BCH", "DL", ("RRCNR", _NR, "BCCH_BCH_Message")),
    _p("nr-rrc.bcch-dl-sch", "NR RRC", "NR", "RRC", "BCCH-DL-SCH", "DL", ("RRCNR", _NR, "BCCH_DL_SCH_Message")),
    _p("nr-rrc.pcch", "NR RRC", "NR", "RRC", "PCCH", "DL", ("RRCNR", _NR, "PCCH_Message")),
    _p("nr-rrc.rrc-reconfiguration", "NR RRC", "NR", "RRC", "RRCReconfiguration", "DL",
       ("RRCNR", _NR, "RRCReconfiguration"), auto=False, label="NR RRCReconfiguration (container)"),
    _p("nr-rrc.rrc-reconfiguration-complete", "NR RRC", "NR", "RRC", "RRCReconfigurationComplete", "UL",
       ("RRCNR", _NR, "RRCReconfigurationComplete"), auto=False, label="NR RRCReconfigurationComplete (container)"),
    _p("nr-rrc.cell-group-config", "NR RRC", "NR", "RRC", "CellGroupConfig", "DL", ("RRCNR", _NR, "CellGroupConfig"),
       auto=False, label="NR CellGroupConfig (container)"),
    _p("nr-rrc.radio-bearer-config", "NR RRC", "NR", "RRC", "RadioBearerConfig", "DL",
       ("RRCNR", _NR, "RadioBearerConfig"), auto=False, label="NR RadioBearerConfig (container)"),
    _p("nr-rrc.ue-nr-capability", "NR RRC", "NR", "RRC", "UE-NR-Capability", None, ("RRCNR", _NR, "UE_NR_Capability"),
       auto=False, label="NR UE-NR-Capability (container)"),
    _p("nr-rrc.ue-mrdc-capability", "NR RRC", "NR", "RRC", "UE-MRDC-Capability", None,
       ("RRCNR", _NR, "UE_MRDC_Capability"), auto=False, label="NR UE-MRDC-Capability (container)"),
    _p("nr-rrc.meas-result-scg-failure", "NR RRC", "NR", "RRC", "MeasResultSCG-Failure", "UL",
       ("RRCNR", _NR, "MeasResultSCG_Failure"), auto=False, label="NR MeasResultSCG-Failure (container)"),
    # --- UMTS RRC (TS 25.331) ---
    _p("umts-rrc.ul-ccch", "WCDMA RRC", "UMTS", "RRC", "UL-CCCH", "UL", ("RRC3G", _U3G, "UL_CCCH_Message"), auto=False),
    _p("umts-rrc.ul-dcch", "WCDMA RRC", "UMTS", "RRC", "UL-DCCH", "UL", ("RRC3G", _U3G, "UL_DCCH_Message"), auto=False),
    _p("umts-rrc.dl-ccch", "WCDMA RRC", "UMTS", "RRC", "DL-CCCH", "DL", ("RRC3G", _U3G, "DL_CCCH_Message"), auto=False),
    _p("umts-rrc.dl-dcch", "WCDMA RRC", "UMTS", "RRC", "DL-DCCH", "DL", ("RRC3G", _U3G, "DL_DCCH_Message"), auto=False),
    _p("umts-rrc.bcch-bch", "WCDMA RRC", "UMTS", "RRC", "BCCH-BCH", "DL", ("RRC3G", _U3G, "BCCH_BCH_Message"), auto=False),
    _p("umts-rrc.bcch-fach", "WCDMA RRC", "UMTS", "RRC", "BCCH-FACH", "DL", ("RRC3G", _U3G, "BCCH_FACH_Message"), auto=False),
    _p("umts-rrc.pcch", "WCDMA RRC", "UMTS", "RRC", "PCCH", "DL", ("RRC3G", _U3G, "PCCH_Message"), auto=False),
    # --- NAS ---
    _p("nas.eps", "EPS NAS", "LTE", "NAS", "EMM / ESM", None, None, codec="nas-eps",
       label="EPS NAS (EMM / ESM, TS 24.301)"),
    _p("nas.5gs", "5GS NAS", "NR", "NAS", "5GMM / 5GSM", None, None, codec="nas-5gs",
       label="5GS NAS (5GMM / 5GSM, TS 24.501)"),
    _p("nas.2g3g", "2G/3G NAS", "UMTS", "NAS", "MM / CC / GMM / SM", None, None, codec="nas-2g3g",
       label="2G/3G NAS (MM, CC, GMM, SM, SMS, TS 24.008)"),
    # --- Network interfaces ---
    _p("s1ap", "S1AP", "LTE", "S1AP", "S1-MME", None, ("S1AP", "S1AP_PDU_Descriptions", "S1AP_PDU"), codec="aper",
       label="S1AP (eNB - MME, TS 36.413)"),
    _p("ngap", "NGAP", "NR", "NGAP", "N2", None, ("NGAP", "NGAP_PDU_Descriptions", "NGAP_PDU"), codec="aper",
       label="NGAP (gNB - AMF, TS 38.413)"),
    _p("x2ap", "X2AP", "LTE", "X2AP", "X2", None, ("X2AP", "X2AP_PDU_Descriptions", "X2AP_PDU"), codec="aper",
       label="X2AP (eNB - eNB / en-gNB, TS 36.423)"),
    _p("xnap", "XnAP", "NR", "XnAP", "Xn", None, ("XnAP", "XnAP_PDU_Descriptions", "XnAP_PDU"), codec="aper",
       label="XnAP (gNB - gNB, TS 38.423)"),
    _p("f1ap", "F1AP", "NR", "F1AP", "F1", None, ("F1AP", "F1AP_PDU_Descriptions", "F1AP_PDU"), codec="aper",
       label="F1AP (gNB-CU - gNB-DU, TS 38.473)"),
    _p("lpp", "LPP", "LTE", "LPP", "LPP", None, ("LPP", "LPP_PDU_Definitions", "LPP_Message"), auto=False,
       label="LPP positioning (TS 37.355)"),
]

BY_ID = {p["id"]: p for p in PROTOCOLS}

GROUPS = ["LTE RRC", "NR RRC", "EPS NAS", "5GS NAS", "NB-IoT RRC", "WCDMA RRC", "2G/3G NAS",
          "S1AP", "NGAP", "X2AP", "XnAP", "F1AP", "LPP"]


def asn1_obj(proto):
    """The pycrate ASN.1 object for a protocol (imports its module on first use)."""
    ref = proto["ref"]
    if ref is None:
        return None
    mod = asn1_module(ref[0])
    return getattr(getattr(mod, ref[1]), ref[2])


def module_name(proto):
    ref = proto.get("ref")
    if not ref:
        return None
    return getattr(asn1_obj(proto), "_mod", None)


def public_catalog():
    out = []
    for p in PROTOCOLS:
        item = {k: p[k] for k in ("id", "family", "rat", "layer", "channel", "direction", "label", "group")}
        item["bundle"] = MODULE_BUNDLE.get(p["ref"][0], "core") if p["ref"] else "core"
        out.append(item)
    return out


def print_err(*args):
    print(*args, file=sys.stderr)
