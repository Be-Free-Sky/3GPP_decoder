"""Radio helpers: ARFCN -> band/frequency, measurement range -> physical value,
PLMN -> operator. Tables follow TS 36.101 (E-UTRA), TS 38.104 / 38.101 (NR)
and TS 36.133 / 38.133 for measurement report mapping.
"""

from pycrate_mobile import MCC_MNC

# --- E-UTRA ---------------------------------------------------------------

# band: (F_DL_low MHz, N_Offs_DL, N_DL_min, N_DL_max, duplex)
EUTRA_DL = {
    1: (2110, 0, 0, 599, "FDD"), 2: (1930, 600, 600, 1199, "FDD"),
    3: (1805, 1200, 1200, 1949, "FDD"), 4: (2110, 1950, 1950, 2399, "FDD"),
    5: (869, 2400, 2400, 2649, "FDD"), 6: (875, 2650, 2650, 2749, "FDD"),
    7: (2620, 2750, 2750, 3449, "FDD"), 8: (925, 3450, 3450, 3799, "FDD"),
    9: (1844.9, 3800, 3800, 4149, "FDD"), 10: (2110, 4150, 4150, 4749, "FDD"),
    11: (1475.9, 4750, 4750, 4949, "FDD"), 12: (729, 5010, 5010, 5179, "FDD"),
    13: (746, 5180, 5180, 5279, "FDD"), 14: (758, 5280, 5280, 5379, "FDD"),
    17: (734, 5730, 5730, 5849, "FDD"), 18: (860, 5850, 5850, 5999, "FDD"),
    19: (875, 6000, 6000, 6149, "FDD"), 20: (791, 6150, 6150, 6449, "FDD"),
    21: (1495.9, 6450, 6450, 6599, "FDD"), 22: (3510, 6600, 6600, 7399, "FDD"),
    23: (2180, 7500, 7500, 7699, "FDD"), 24: (1525, 7700, 7700, 8039, "FDD"),
    25: (1930, 8040, 8040, 8689, "FDD"), 26: (859, 8690, 8690, 9039, "FDD"),
    27: (852, 9040, 9040, 9209, "FDD"), 28: (758, 9210, 9210, 9659, "FDD"),
    29: (717, 9660, 9660, 9769, "SDL"), 30: (2350, 9770, 9770, 9869, "FDD"),
    31: (462.5, 9870, 9870, 9919, "FDD"), 32: (1452, 9920, 9920, 10359, "SDL"),
    33: (1900, 36000, 36000, 36199, "TDD"), 34: (2010, 36200, 36200, 36349, "TDD"),
    35: (1850, 36350, 36350, 36949, "TDD"), 36: (1930, 36950, 36950, 37549, "TDD"),
    37: (1910, 37550, 37550, 37749, "TDD"), 38: (2570, 37750, 37750, 38249, "TDD"),
    39: (1880, 38250, 38250, 38649, "TDD"), 40: (2300, 38650, 38650, 39649, "TDD"),
    41: (2496, 39650, 39650, 41589, "TDD"), 42: (3400, 41590, 41590, 43589, "TDD"),
    43: (3600, 43590, 43590, 45589, "TDD"), 44: (703, 45590, 45590, 46589, "TDD"),
    45: (1447, 46590, 46590, 46789, "TDD"), 46: (5150, 46790, 46790, 54539, "TDD"),
    47: (5855, 54540, 54540, 55239, "TDD"), 48: (3550, 55240, 55240, 56739, "TDD"),
    49: (3550, 56740, 56740, 58239, "TDD"), 50: (1432, 58240, 58240, 59089, "TDD"),
    51: (1427, 59090, 59090, 59139, "TDD"), 52: (3300, 59140, 59140, 60139, "TDD"),
    53: (2483.5, 60140, 60140, 60254, "TDD"),
    65: (2110, 65536, 65536, 66435, "FDD"), 66: (2110, 66436, 66436, 67335, "FDD"),
    67: (738, 67336, 67336, 67535, "SDL"), 68: (753, 67536, 67536, 67835, "FDD"),
    69: (2570, 67836, 67836, 68335, "SDL"), 70: (1995, 68336, 68336, 68585, "FDD"),
    71: (617, 68586, 68586, 68935, "FDD"), 72: (461, 68936, 68936, 68985, "FDD"),
    73: (460, 68986, 68986, 69035, "FDD"), 74: (1475, 69036, 69036, 69465, "FDD"),
    75: (1432, 69466, 69466, 70315, "SDL"), 76: (1427, 70316, 70316, 70365, "SDL"),
    85: (728, 70366, 70366, 70545, "FDD"), 87: (420, 70546, 70546, 70595, "FDD"),
    88: (422, 70596, 70596, 70645, "FDD"),
}

# band: (F_UL_low MHz, N_Offs_UL, N_UL_min, N_UL_max) for common FDD bands
EUTRA_UL = {
    1: (1920, 18000, 18000, 18599), 2: (1850, 18600, 18600, 19199),
    3: (1710, 19200, 19200, 19949), 4: (1710, 19950, 19950, 20399),
    5: (824, 20400, 20400, 20649), 7: (2500, 20750, 20750, 21449),
    8: (880, 21450, 21450, 21799), 12: (699, 23010, 23010, 23179),
    13: (777, 23180, 23180, 23279), 17: (704, 23730, 23730, 23849),
    18: (815, 23850, 23850, 23999), 19: (830, 24000, 24000, 24149),
    20: (832, 24150, 24150, 24449), 25: (1850, 26040, 26040, 26689),
    26: (814, 26690, 26690, 27039), 28: (703, 27210, 27210, 27659),
    66: (1710, 131972, 131972, 132671), 71: (663, 133122, 133122, 133471),
}


def earfcn_info(n, uplink=False):
    """Return dict(band, freq_mhz, duplex, link) or None."""
    if n is None:
        return None
    if not uplink:
        for band, (f_low, offs, lo, hi, duplex) in EUTRA_DL.items():
            if lo <= n <= hi:
                return {"band": band, "freq": round(f_low + 0.1 * (n - offs), 1),
                        "duplex": duplex, "link": "DL" if duplex != "TDD" else "DL/UL"}
    for band, (f_low, offs, lo, hi) in EUTRA_UL.items():
        if lo <= n <= hi:
            return {"band": band, "freq": round(f_low + 0.1 * (n - offs), 1),
                    "duplex": "FDD", "link": "UL"}
    if uplink:
        return earfcn_info(n, uplink=False)
    return None


def earfcn_text(n, uplink=False):
    info = earfcn_info(n, uplink)
    if not info:
        return None
    return f"Band {info['band']} {info['duplex']}, {info['link']} {info['freq']:g} MHz"


# --- NR ---------------------------------------------------------------------

# band: (DL_low, DL_high, duplex, UL_low, UL_high) in MHz
NR_BANDS = {
    1: (2110, 2170, "FDD", 1920, 1980), 2: (1930, 1990, "FDD", 1850, 1910),
    3: (1805, 1880, "FDD", 1710, 1785), 5: (869, 894, "FDD", 824, 849),
    7: (2620, 2690, "FDD", 2500, 2570), 8: (925, 960, "FDD", 880, 915),
    12: (729, 746, "FDD", 699, 716), 13: (746, 756, "FDD", 777, 787),
    14: (758, 768, "FDD", 788, 798), 18: (860, 875, "FDD", 815, 830),
    20: (791, 821, "FDD", 832, 862), 25: (1930, 1995, "FDD", 1850, 1915),
    26: (859, 894, "FDD", 814, 849), 28: (758, 803, "FDD", 703, 748),
    29: (717, 728, "SDL", None, None), 30: (2350, 2360, "FDD", 2305, 2315),
    34: (2010, 2025, "TDD", None, None), 38: (2570, 2620, "TDD", None, None),
    39: (1880, 1920, "TDD", None, None), 40: (2300, 2400, "TDD", None, None),
    41: (2496, 2690, "TDD", None, None), 46: (5150, 5925, "TDD", None, None),
    48: (3550, 3700, "TDD", None, None), 50: (1432, 1517, "TDD", None, None),
    51: (1427, 1432, "TDD", None, None), 53: (2483.5, 2495, "TDD", None, None),
    65: (2110, 2200, "FDD", 1920, 2010), 66: (2110, 2200, "FDD", 1710, 1780),
    70: (1995, 2020, "FDD", 1695, 1710), 71: (617, 652, "FDD", 663, 698),
    74: (1475, 1518, "FDD", 1427, 1470), 75: (1432, 1517, "SDL", None, None),
    76: (1427, 1432, "SDL", None, None), 77: (3300, 4200, "TDD", None, None),
    78: (3300, 3800, "TDD", None, None), 79: (4400, 5000, "TDD", None, None),
    80: (None, None, "SUL", 1710, 1785), 81: (None, None, "SUL", 880, 915),
    82: (None, None, "SUL", 832, 862), 83: (None, None, "SUL", 703, 748),
    84: (None, None, "SUL", 1920, 1980), 86: (None, None, "SUL", 1710, 1780),
    90: (2496, 2690, "TDD", None, None), 96: (5925, 7125, "TDD", None, None),
    104: (6425, 7125, "TDD", None, None),
    257: (26500, 29500, "TDD", None, None), 258: (24250, 27500, "TDD", None, None),
    259: (39500, 43500, "TDD", None, None), 260: (37000, 40000, "TDD", None, None),
    261: (27500, 28350, "TDD", None, None), 262: (47200, 48200, "TDD", None, None),
}


def nrarfcn_freq(n):
    if n is None or n < 0:
        return None
    if n < 600000:
        return 0.005 * n
    if n < 2016667:
        return 3000 + 0.015 * (n - 600000)
    return 24250.08 + 0.06 * (n - 2016667)


def nr_bands_for_freq(f, uplink=False):
    hits = []
    for band, (dl_lo, dl_hi, duplex, ul_lo, ul_hi) in NR_BANDS.items():
        if not uplink and dl_lo is not None and dl_lo <= f <= dl_hi:
            hits.append((dl_hi - dl_lo, band, duplex, "DL" if duplex != "TDD" else "DL/UL"))
        elif uplink and ul_lo is not None and ul_lo <= f <= ul_hi:
            hits.append((ul_hi - ul_lo, band, duplex, "UL"))
    # narrowest band first: 3500 MHz -> n78 before n77
    hits.sort()
    return hits


def nrarfcn_info(n, uplink=False):
    f = nrarfcn_freq(n)
    if f is None:
        return None
    hits = nr_bands_for_freq(f, uplink) or nr_bands_for_freq(f, not uplink)
    fr = "FR2" if f >= 24250 else "FR1"
    if not hits:
        return {"freq": round(f, 3), "bands": [], "fr": fr}
    return {"freq": round(f, 3), "bands": [h[1] for h in hits], "duplex": hits[0][2],
            "link": hits[0][3], "fr": fr}


def nrarfcn_text(n, uplink=False):
    info = nrarfcn_info(n, uplink)
    if not info:
        return None
    f = f"{info['freq']:.2f}".rstrip("0").rstrip(".")
    if not info["bands"]:
        return f"{f} MHz ({info['fr']})"
    main = f"n{info['bands'][0]}"
    others = ", ".join(f"n{b}" for b in info["bands"][1:3])
    extra = f" (also {others})" if others else ""
    return f"{main}{extra} {info['duplex']}, {f} MHz, {info['fr']}"


# --- Measurement mapping ----------------------------------------------------

def quality_rsrp(dbm):
    if dbm >= -80:
        return "excellent"
    if dbm >= -90:
        return "good"
    if dbm >= -100:
        return "fair"
    if dbm >= -110:
        return "poor"
    return "bad"


def quality_rsrq(db):
    if db >= -10:
        return "excellent"
    if db >= -15:
        return "good"
    if db >= -20:
        return "fair"
    return "poor"


def quality_sinr(db):
    if db >= 20:
        return "excellent"
    if db >= 13:
        return "good"
    if db >= 0:
        return "fair"
    return "poor"


QUALITY_TEXT = {"excellent": "Excellent", "good": "Good", "fair": "Fair", "poor": "Poor",
                "bad": "Very poor"}


def lte_rsrp(idx):
    """TS 36.133 Table 9.1.4-1: RSRP_00 < -140 dBm ... RSRP_97 >= -44 dBm."""
    if idx <= 0:
        return -141, "< -140 dBm"
    if idx >= 97:
        return -44, ">= -44 dBm"
    return idx - 141, f"{idx - 141} dBm"


def lte_rsrq(idx):
    """TS 36.133 Table 9.1.7-1 incl. extended range (RSRQ-Range-r13)."""
    if idx == 0:
        return -20.0, "< -19.5 dB"
    if idx < 0:
        v = -19.5 + 0.5 * idx
    else:
        v = -20 + 0.5 * idx
    return v, f"{v:g} dB"


def lte_sinr(idx):
    """RS-SINR-Range-r13: SINR_000 < -23 dB, step 0.5 dB."""
    if idx <= 0:
        return -23.5, "< -23 dB"
    v = -23 + 0.5 * (idx - 1)
    return v, f"{v:g} dB"


def nr_rsrp(idx):
    """TS 38.133 Table 10.1.6.1-1: RSRP_0 < -156 dBm, 1 dB steps up to -31 dBm."""
    if idx <= 0:
        return -157, "< -156 dBm"
    if idx >= 126:
        return -31, ">= -31 dBm"
    return idx - 157, f"{idx - 157} dBm"


def nr_rsrq(idx):
    """TS 38.133 Table 10.1.11.1-1: RSRQ_0 < -43 dB, step 0.5 dB."""
    if idx <= 0:
        return -43.5, "< -43 dB"
    v = -43 + 0.5 * (idx - 1)
    return v, f"{v:g} dB"


def nr_sinr(idx):
    """TS 38.133 Table 10.1.16.1-1: SINR_0 < -23 dB, step 0.5 dB."""
    if idx <= 0:
        return -23.5, "< -23 dB"
    v = -23 + 0.5 * (idx - 1)
    return v, f"{v:g} dB"


# --- PLMN -------------------------------------------------------------------

# Supplements for operators the bundled table does not name.
_EXTRA_OPERATORS = {
    "46000": "China Mobile", "46002": "China Mobile", "46004": "China Mobile",
    "46007": "China Mobile", "46008": "China Mobile", "46001": "China Unicom",
    "46006": "China Unicom", "46009": "China Unicom", "46003": "China Telecom",
    "46005": "China Telecom", "46011": "China Telecom", "46015": "China Broadnet",
    "405840": "Reliance Jio", "405854": "Reliance Jio", "405855": "Reliance Jio",
    "405856": "Reliance Jio", "405857": "Reliance Jio", "405858": "Reliance Jio",
    "405859": "Reliance Jio", "405860": "Reliance Jio", "405861": "Reliance Jio",
    "405862": "Reliance Jio", "405863": "Reliance Jio", "405864": "Reliance Jio",
    "405865": "Reliance Jio", "405866": "Reliance Jio", "405867": "Reliance Jio",
    "405868": "Reliance Jio", "405869": "Reliance Jio", "405870": "Reliance Jio",
    "405871": "Reliance Jio", "405872": "Reliance Jio", "405873": "Reliance Jio",
    "405874": "Reliance Jio",
    "00101": "Test network", "001001": "Test network", "00102": "Test network",
    "99999": "Test network", "999999": "Test network", "99970": "Test network",
}


def plmn_text(mcc, mnc):
    """mcc/mnc as digit strings. Returns 'MCC 460 MNC 00, China Mobile (China)'."""
    if not mnc:
        return None
    key = (mcc or "") + mnc
    country = None
    operator = _EXTRA_OPERATORS.get(key)
    hit = MCC_MNC.MNC_dict.get(key)
    if hit:
        country = hit[2]
        operator = operator or hit[3]
    if mcc and not country:
        c = MCC_MNC.MCC_dict.get(mcc)
        if c:
            country = c[2]
    head = f"MCC {mcc} MNC {mnc}" if mcc else f"MNC {mnc}"
    if operator and country:
        return f"{head}, {operator} ({country})"
    if operator:
        return f"{head}, {operator}"
    if country:
        return f"{head}, {country}"
    return head


def plmn_from_bytes(b):
    """3-octet TBCD PLMN (S1AP/NGAP/NAS) -> (mcc, mnc)."""
    if not b or len(b) != 3:
        return None, None
    d = [b[0] & 0xF, b[0] >> 4, b[1] & 0xF, b[1] >> 4, b[2] & 0xF, b[2] >> 4]
    mcc = "".join(str(x) for x in d[0:3])
    mnc3 = d[3]
    mnc = f"{d[4]}{d[5]}" + ("" if mnc3 == 0xF else str(mnc3))
    return mcc, mnc
