"""Small corrections to pycrate message definitions.

pycrate 0.8.1 codes the T3346 IEI of the EPS Service Reject as 0x5C. TS 24.301
(table 8.2.24.1) and the Attach / TAU Reject definitions in pycrate itself use
0x5F, so real Service Reject messages carrying T3346 were not fully decoded.
"""

import contextlib
import io

with contextlib.redirect_stdout(io.StringIO()):
    from pycrate_mobile import TS24301_EMM
    from pycrate_mobile.TS24007 import Type4TLV
    from pycrate_mobile.TS24008_IE import GPRSTimer

_applied = False


def apply():
    global _applied
    if _applied:
        return
    cls = TS24301_EMM.EMMServiceReject
    gen = list(cls._GEN)
    for i, ie in enumerate(gen):
        if ie._name == "T3346" and ie[0].get_val() == 0x5C:
            gen[i] = Type4TLV("T3346", val={"T": 0x5F, "V": b"\0"}, IE=GPRSTimer())
    cls._GEN = tuple(gen)
    _applied = True
