"""Per-message analysis: plain-English summary, key highlights, RCA findings.

Each analyzer receives the decode result (with private `_val` / `_msg`) and
fills res["summary"], res["highlights"], res["findings"], res["facts"].
"""

from .common import finalize


def analyze(res, proto):
    from . import lte_rrc, nr_rrc, nas, ap  # noqa: F401

    res.setdefault("facts", {})
    fam = proto["family"]
    if fam in ("LTE RRC", "NB-IoT RRC"):
        lte_rrc.analyze(res, proto)
    elif fam == "NR RRC":
        nr_rrc.analyze(res, proto)
    elif proto["layer"] == "NAS":
        nas.analyze(res, proto)
    elif proto["layer"] in ("S1AP", "NGAP", "X2AP", "XnAP", "F1AP"):
        ap.analyze(res, proto)
    finalize(res)
