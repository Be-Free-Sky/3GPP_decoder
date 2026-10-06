"""Parse pasted log text into message records.

Accepted shapes:
  * bare hex: "40 12 0a ...", "40120a...", "0x40,0x12,..."
  * hexdump lines with offsets and an ASCII column ("0000: 40 12 0a ...  @..")
  * log lines with a header and trailing hex ("10:21:33.120 LTE RRC UL_DCCH MeasurementReport: 08 10 ...")
  * a header line followed by hex lines (Logel / QXDM text exports)
Each record keeps the header text, which is mined for channel / RAT / message hints.
"""

import re

_TS_RE = re.compile(r"(?<!\d)(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)(?!\d)")
_DATE_RE = re.compile(r"\b\d{4}[-/]\d{2}[-/]\d{2}\b")
_OFFSET_RE = re.compile(r"^\s*(?:0x)?[0-9a-fA-F]{4,8}\s*[:|]\s*")
_OFFSET_PLAIN_RE = re.compile(r"^\s*(?:0x)?[0-9a-fA-F]{4,8}\s{1,}(?=(?:[0-9a-fA-F]{2}\s){4,})")
_BYTE_TOKEN = re.compile(r"^(?:0x)?[0-9a-fA-F]{2}$", re.I)
_LONG_HEX = re.compile(r"^(?:0x)?(?:[0-9a-fA-F]{2})+$", re.I)
_TRAIL_HEX = re.compile(r"(?:[:=|\t]|\s{2,}|\bhex\b|\bdata\b|\bpayload\b|\braw\b)\s*((?:(?:0x)?[0-9a-fA-F]{2}[\s,]*){2,}|(?:0x)?(?:[0-9a-fA-F]{2}){3,})\s*$", re.I)


def _tokens_to_bytes(tokens):
    out = bytearray()
    for t in tokens:
        t = t.lower()
        if t.startswith("0x"):
            t = t[2:]
        if len(t) % 2:
            return None
        try:
            out += bytes.fromhex(t)
        except ValueError:
            return None
    return bytes(out)


def _strip_hexdump(line):
    """Remove an offset prefix and an ASCII column from a hexdump line."""
    m = _OFFSET_RE.match(line) or _OFFSET_PLAIN_RE.match(line)
    if not m:
        return line, False
    rest = line[m.end():]
    toks = []
    for t in re.split(r"[\s,]+", rest.strip()):
        if _BYTE_TOKEN.match(t):
            toks.append(t)
        else:
            break
    return " ".join(toks), True


def classify(line):
    """Return (kind, bytes, header) where kind is 'hex', 'header', 'mixed' or 'blank'."""
    s = line.strip()
    if not s:
        return "blank", None, None
    body, was_dump = _strip_hexdump(s)
    toks = [t for t in re.split(r"[\s,;]+", body.strip()) if t]
    if toks and all(_BYTE_TOKEN.match(t) or _LONG_HEX.match(t) for t in toks):
        b = _tokens_to_bytes(toks)
        if b:
            return "hex", b, None
    # header text with a hex payload at the end
    m = _TRAIL_HEX.search(s)
    if m:
        payload = m.group(1)
        toks = [t for t in re.split(r"[\s,]+", payload.strip()) if t]
        b = _tokens_to_bytes(toks)
        if b and len(b) >= 2:
            header = s[: m.start(1)].strip(" :=|\t")
            return "mixed", b, header
    return "header", None, s


def parse_records(text, split="auto"):
    """Split pasted text into records: [{bytes, header, timestamp, line}]."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    if split == "single":
        hexbuf = bytearray()
        header = None
        for ln in lines:
            kind, b, h = classify(ln)
            if b:
                hexbuf += b
            if h and header is None:
                header = h
        if not hexbuf:
            return []
        return [_mk(bytes(hexbuf), header, 1)]

    rows = []
    for i, ln in enumerate(lines, 1):
        kind, b, h = classify(ln)
        rows.append((kind, b, h, i))

    has_header = any(k in ("header", "mixed") for k, _, _, _ in rows)
    hex_rows = [r for r in rows if r[0] == "hex"]

    if split == "lines" or (split == "auto" and not has_header):
        # Without headers: either one wrapped message or one message per line / block
        blocks, cur = [], []
        for kind, b, h, i in rows:
            if kind == "blank":
                if cur:
                    blocks.append(cur)
                    cur = []
                continue
            if kind == "hex":
                cur.append((b, i, _is_dump(lines[i - 1])))
        if cur:
            blocks.append(cur)
        records = []
        for blk in blocks:
            if split == "lines":
                records.extend(_mk(b, None, i) for b, i, _ in blk)
            elif _looks_wrapped(blk):
                records.append(_mk(b"".join(b for b, _, _ in blk), None, blk[0][1]))
            else:
                records.extend(_mk(b, None, i) for b, i, _ in blk)
        return records

    # With headers: a header starts a record; following hex lines belong to it
    records = []
    cur = None
    for kind, b, h, i in rows:
        if kind == "header":
            if cur and cur["bytes"]:
                records.append(cur)
            cur = {"bytes": b"", "header": h, "line": i}
        elif kind == "mixed":
            if cur and cur["bytes"]:
                records.append(cur)
            cur = {"bytes": b, "header": h, "line": i}
        elif kind == "hex":
            if cur is None:
                cur = {"bytes": b"", "header": None, "line": i}
            cur["bytes"] += b
        elif kind == "blank":
            if cur and cur["bytes"]:
                records.append(cur)
                cur = None
    if cur and cur["bytes"]:
        records.append(cur)
    return [_mk(r["bytes"], r["header"], r["line"]) for r in records]


def _is_dump(line):
    return bool(_OFFSET_RE.match(line) or _OFFSET_PLAIN_RE.match(line))


def _looks_wrapped(blk):
    """A block of lines that is one message wrapped at a fixed width."""
    if len(blk) == 1:
        return True
    if all(d for _, _, d in blk):
        return True
    lens = [len(b) for b, _, _ in blk]
    first = lens[:-1]
    # wrapped dumps use a fixed width of 16 bytes or more; shorter equal lines are separate messages
    return len(set(first)) == 1 and first[0] >= 16 and lens[-1] <= first[0]


def _mk(b, header, line):
    rec = {"bytes": b, "header": header, "line": line, "timestamp": None}
    if header:
        m = _TS_RE.search(header)
        if m:
            rec["timestamp"] = m.group(1).replace(",", ".")
            d = _DATE_RE.search(header)
            if d:
                rec["date"] = d.group(0)
    return rec


# --- hints from header text ------------------------------------------------

_CHANNELS = [
    (r"ul[-_ ]?ccch1", "UL-CCCH1"), (r"ul[-_ ]?ccch", "UL-CCCH"), (r"ul[-_ ]?dcch", "UL-DCCH"),
    (r"dl[-_ ]?ccch", "DL-CCCH"), (r"dl[-_ ]?dcch", "DL-DCCH"), (r"bcch[-_ ]?dl[-_ ]?sch", "BCCH-DL-SCH"),
    (r"bcch[-_ ]?bch", "BCCH-BCH"), (r"\bpcch\b", "PCCH"), (r"\bmcch\b", "MCCH"),
    (r"\bmib\b", "BCCH-BCH"), (r"\bsib\d*\b", "BCCH-DL-SCH"),
]


def hints_from_header(header):
    h = {}
    if not header:
        return h
    low = header.lower()
    norm = re.sub(r"[^a-z0-9]", "", low)
    h["text"] = norm
    if re.search(r"\b(nr5g|5g ?nr|nr|gnb|nr-rrc|nrrrc|5g)\b", low) or "nr5g" in norm:
        h["rat"] = "NR"
    if re.search(r"\b(lte|4g|eutra|enb|eps)\b", low):
        h["rat"] = "LTE" if "rat" not in h or "nr5g" not in norm else h["rat"]
    if re.search(r"\b(wcdma|umts|3g|utra)\b", low):
        h["rat"] = "UMTS"
    if re.search(r"\b(nb-?iot|nb1|nbiot)\b", low):
        h["rat"] = "NB-IoT"
    for rx, ch in _CHANNELS:
        if re.search(rx, low):
            h["channel"] = ch
            break
    if re.search(r"\b(5gmm|5gsm|nas5g|5g ?nas|nas ?5g)\b", low) or "5gmm" in norm or "5gsm" in norm:
        h["protocol"] = "nas.5gs"
    elif re.search(r"\b(emm|esm|eps ?nas|lte ?nas|nas ?lte)\b", low):
        h["protocol"] = "nas.eps"
    elif re.search(r"\bnas\b", low) and "channel" not in h:
        h["protocol"] = "nas.5gs" if h.get("rat") == "NR" else "nas.eps" if h.get("rat") == "LTE" else None
        if h["protocol"] is None:
            del h["protocol"]
    for ap, pid in (("s1ap", "s1ap"), ("ngap", "ngap"), ("x2ap", "x2ap"), ("xnap", "xnap"), ("f1ap", "f1ap")):
        if ap in norm:
            h["protocol"] = pid
            h["ap"] = True
    if re.search(r"\b(ul|uplink|tx|ue ?->|mo)\b", low):
        h["direction"] = "UL"
    elif re.search(r"\b(dl|downlink|rx|-> ?ue|mt)\b", low):
        h["direction"] = "DL"
    if h.get("rat") and h.get("channel") and "protocol" not in h:
        fam = {"LTE": "lte-rrc", "NR": "nr-rrc", "UMTS": "umts-rrc", "NB-IoT": "nbiot-rrc"}.get(h["rat"])
        if fam:
            h["protocol"] = f"{fam}.{h['channel'].lower()}"
    return h
