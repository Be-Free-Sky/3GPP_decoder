"""Build synthetic UNISOC Logel armlogs (zips) for the end-to-end test.

Sample sessions are written in the same binary layout as a real .logel (see
src/lib/capture/logel.ts), next to the other files Logel saves: an IP capture with DNS,
version files, empty files and a Logel view cache. No real device data is involved.

    python decoder/tools/build_logel_fixture.py OUT.zip            one armlog (registration reject)
    python decoder/tools/build_logel_fixture.py OUT.zip --multi    four armlog folders in one zip:
        registration reject; PDU session reject ending in an assert asked for with
        AT+SPATASSERT (only in the .logel's assert console); a folder without a .logel; and a
        modem assert in NR RRC (a UNISOC .ass record, the assert console and a memory dump
        inside the .logel, the cores' assert lines, a memory dump and an RFIC dump)

Every folder also has Logel's decoded trace view (traceview.dat with its traceview.pbs index,
whose rows point at the .logel packet each line came from). The assert records follow the
layout of real UNISOC records with made-up values.
"""

import json
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = "2026_01_15_09_14_00_000"

RRC_CODE = {"BCCH_BCH": 1, "BCCH_DL_SCH": 2, "PCCH": 3, "DL_CCCH": 4, "DL_DCCH": 5, "UL_CCCH": 6, "UL_DCCH": 7}
START_TICK = 500_000
PC_START_MS = 1_768_468_440_000  # 2026-01-15 09:14:00.000, stored as if UTC (like Logel)


def packet(typ, sub, data, seq=0):
    return struct.pack("<IIHBB", 8 + len(data), seq, 8 + len(data), typ, sub) + data


def pad4(b):
    return b + b"\x00" * (-len(b) % 4)


def signal(grp, code, snd, rcv, tick, pdu, body_len=12):
    body = struct.pack("<HHHH", 0x1C, 8 + body_len, 0, body_len) + bytes(body_len)
    sec = struct.pack("<HH", 0x28, len(pdu)) + pdu
    hdr = bytearray(48)
    hdr[0] = 1
    hdr[8:12] = bytes([5, 7, snd, rcv])
    hdr[12] = grp
    struct.pack_into("<H", hdr, 14, code)
    hdr[16] = 1
    struct.pack_into("<HH", hdr, 18, 8 + body_len, 8 + body_len)
    hdr[28:31] = b"\x01\x02\x00"
    struct.pack_into("<HH", hdr, 32, len(pdu), len(pdu))
    struct.pack_into("<I", hdr, 40, tick)
    rec = pad4(b"\x00\x00\x30\x00" + bytes(hdr) + body + sec)
    return struct.pack("<II", 0x20F, len(rec) // 4) + rec


def trace(fmt, args=()):
    s = pad4(fmt.encode() + b"\x00")
    info = len(args) | ((len(s) // 4) << 5)
    payload = struct.pack("<I", info) + s + b"".join(struct.pack("<i", a) for a in args)
    return struct.pack("<II", 0x3F, len(payload) // 4) + payload


def build_logel(session, pc_start_ms=PC_START_MS, crash=None):
    """crash: None, or {"tick", "record" (console text), "lines" (PS traces), "phy" (NR PHY trace)}.
    Returns the file and the protocol stack packets as (file offset, tick)."""
    items = []  # (tick, bytes)
    lines = session["text"].splitlines()
    t0 = None
    for i in range(0, len(lines) - 1):
        head = lines[i].split()
        if len(head) < 4 or ":" not in head[0]:
            continue
        h, m, s = head[0].split(":")
        ms = (int(h) * 3600 + int(m) * 60 + float(s)) * 1000
        t0 = ms if t0 is None else t0
        tick = START_TICK + int(ms - t0)
        pdu = bytes.fromhex(lines[i + 1].replace(" ", ""))
        if head[1] in ("NR5G", "NR") and head[2] == "RRC":
            items.append((tick, signal(249, RRC_CODE[head[3]], 177, 177, tick, pdu)))
        elif "NAS" in head:
            items.append((tick, signal(198, 9680, 170, 170, tick, pdu, body_len=204)))
    # modem radio traces: serving cell, RSRP every 120 ms, SINR from the PHY summary
    last = items[-1][0]
    for k, tick in enumerate(range(START_TICK, last + 1, 120)):
        if k % 10 == 0:
            items.append((tick, trace("NRRC: Get NR Serving cell info, pci:%x,afrcn:%x,bandwidth:%x", (101, 627264, 100))))
        items.append((tick, trace("A2 rsrp enter Ms = %d hys = %d a2_Threshold = %d isSatifiesCell = %d", (-8850 - (k % 7) * 40, 0, -10500, 0))))
        if k % 4 == 0:
            items.append((tick, trace("NRRC: nreng_get_phy_static_info,dl bler:%d,ul bler:%d,tx power:%d,sinr:%d", (0, 0, 100, 1450 - k * 10))))
    # AT answers the modem sent to the host
    for tick, line in ((START_TICK + 50, '+C5GREG: 2,2'), (START_TICK + 400, '+CESQ: 99,99,255,255,255,255,72,68,70'),
                       (last + 30, '+C5GREG: 2,3'), (last + 40, '+COPS: 0,0,"Test Network",11')):
        items.append((tick, trace(line + "\r\n")))
    for line in (crash or {}).get("lines", []):
        items.append((crash["tick"], trace(line)))
    items.sort(key=lambda x: x[0])

    out = bytearray()
    out += packet(0xD1, 0x65, struct.pack("<II", 7, 0x10101))
    out += packet(0xD1, 0x80, struct.pack("<QI", pc_start_ms, START_TICK), seq=0xFFFF)
    # cut the item stream into fixed packets so some items cross a packet boundary
    stream = bytearray()
    ticks = []
    for tick, b in items:
        ticks.append((len(stream), tick))
        stream += b
    seq = 0x100
    pos = 0
    chunk = 700
    ps_packets = []
    while pos < len(stream):
        tick = max(t for o, t in ticks if o <= pos)
        part = bytes(stream[pos:pos + chunk])
        ps_packets.append((len(out), tick))
        out += packet(0xF8, 0xFF, struct.pack("<III", 0, 1000, tick) + bytes(12) + part, seq=seq)
        seq += 1
        pos += chunk
        if seq == 0x102:
            out += packet(0x00, 0x00, b"\nPlatform Version: MOCORTM_TEST\nProject Version:   Fixture_NR_modem\n")
            out += packet(0x05, 0x11, struct.pack("<IIII", 0, pc_start_ms // 1000 + 3, 0, START_TICK + 3000))
    # a PHY stream that holds nothing readable (its own clock: it is timed by its place in the file)
    out += packet(0xD1, 0x81, struct.pack("<QI", pc_start_ms, 7000))
    for k in range(3):
        out += packet(0xF8, 0xFE, struct.pack("<III", 0, 1000, 7000 + k) + bytes(12) + bytes(range(256)) * 4, seq=0x9000 + k)
    if crash:
        # the other core stops with it, then the modem prints its assert record on its console
        if crash.get("phy"):
            out += packet(0xF8, 0xFE, struct.pack("<III", 0, 1000, 7010) + bytes(12) + pad4(trace(crash["phy"])), seq=0x9010)
        for line in crash["record"].split("\n"):
            out += packet(0xFF, 0x00, ("\n" + line + "\n").encode())
        # and sends its memory: the firmware's own message text must not count as crashes
        firmware = (b"\x78\x56\x34\x12\x01\x00\x00\x00" + bytes(56) + b"psAssert %s\x00Watch Dog Timer Expired.\x00"
                    b"osa_internal_alloc: Memory allocation Failed\x00SIGABRT: Abnormal termination\x00"
                    b"Modem Assert: %s %s assert in file %s line %d exp=%s info=[%s]\x00" + bytes(64))
        for k in range(4):
            out += packet(0xFF, 0x01, firmware + bytes(range(256)) * 8, seq=0xA000 + k)
    return bytes(out), ps_packets


def dns(qid, name, qtype, response=False, rcode=0, answers=0):
    q = b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\x00" + struct.pack(">HH", qtype, 1)
    flags = 0x8180 | rcode if response else 0x0100
    msg = struct.pack(">HHHHHH", qid, flags, 1, answers, 0, 0) + q
    for _ in range(answers):
        msg += b"\xc0\x0c" + struct.pack(">HHIH", qtype, 1, 60, 16 if qtype == 28 else 4) + bytes(16 if qtype == 28 else 4)
    return msg


def ip6_udp(src, dst, sport, dport, payload):
    udp = struct.pack(">HHHH", sport, dport, 8 + len(payload), 0) + payload
    return struct.pack(">IHBB", 0x60000000, len(udp), 17, 64) + src + dst + udp


def build_pcap(pc_start_ms=PC_START_MS):
    ue = bytes.fromhex("24090000000000000000000000000001")
    dns_srv = bytes.fromhex("24050000000000000000000000000011")
    pkts = [
        (1.0, 1, ip6_udp(ue, dns_srv, 40000, 53, dns(1, "connectivity.example.net", 28))),
        (1.03, 2, ip6_udp(dns_srv, ue, 53, 40000, dns(1, "connectivity.example.net", 28, True, 0, 1))),
        (2.0, 1, ip6_udp(ue, dns_srv, 40001, 53, dns(2, "nosuch.example.net", 1))),
        (2.04, 2, ip6_udp(dns_srv, ue, 53, 40001, dns(2, "nosuch.example.net", 1, True, 3))),
        (3.0, 1, ip6_udp(ue, dns_srv, 40002, 53, dns(3, "silent.example.net", 1))),
        (9.0, 1, ip6_udp(ue, dns_srv, 40003, 53, dns(4, "late.example.net", 1))),
        (12.5, 2, ip6_udp(dns_srv, ue, 53, 40003, dns(4, "late.example.net", 1, True, 0, 1))),
    ]
    out = bytearray(struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1))
    for k, (dt, direction, ip) in enumerate(pkts):
        frame = struct.pack("<I", k) + bytes([0, direction]) + bytes(6) + b"\x86\xdd" + ip
        sec = pc_start_ms // 1000 + int(dt)
        usec = int(round((dt % 1) * 1e6))
        out += struct.pack("<IIII", sec, usec, len(frame), len(frame)) + frame
    return bytes(out)


def last_tick(session):
    """Tick of the last message of a session, as build_logel lays it out."""
    stamps = []
    for line in session["text"].splitlines():
        head = line.split()
        if len(head) >= 4 and ":" in head[0]:
            h, m, sec = head[0].split(":")
            stamps.append((int(h) * 3600 + int(m) * 60 + float(sec)) * 1000)
    return START_TICK + int(max(stamps) - min(stamps))


def clock(ms):
    t = ms % 86_400_000
    return f"{t // 3_600_000:02d}:{t // 60_000 % 60:02d}:{t // 1000 % 60:02d}.{t % 1000:03d}"


def logel_header(magic, pc_ms, tick):
    """The head Logel writes on its view files: magic, (1, 2, 3), then the PC time of a tick."""
    return magic + struct.pack("<III", 1, 2, 3) + struct.pack("<QI", pc_ms, tick) + struct.pack("<QI", pc_ms, tick) + bytes(0x200 - 40)


def traceview(lines, ps_packets=(), clock=None):
    """Logel's decoded trace view: NUL-ended lines (.dat) and the TIND index (.pbs): a 0x200
    header, then 44 bytes per line: the .logel packet's sequence number at +4, the tick at +12,
    length at +26, offset in the .dat at +28 and the .logel packet's offset at +36."""
    dat = bytearray()
    pbs = bytearray(logel_header(b"TIND", *clock) if clock else b"TIND" + bytes(0x200 - 4))
    for k, (tick, text) in enumerate(lines):
        raw = text.encode() + b"\x00"
        row = bytearray(44)
        home = [o for o, t in ps_packets if t <= tick]
        struct.pack_into("<III", row, 0, k, 0x100 + k, k)
        struct.pack_into("<I", row, 12, tick)
        struct.pack_into("<H", row, 26, len(raw))
        struct.pack_into("<Q", row, 28, len(dat))
        struct.pack_into("<Q", row, 36, home[-1] if home else 0)
        pbs += row
        dat += raw
    return bytes(dat), bytes(pbs)


def unisoc_record(name, file, line, check, info, task, queue_used=0, dumps=True, corrupt=False):
    """An assert record in the layout UNISOC modems print (and Logel saves as .ass), made-up values."""
    out = f""" >
======================================core0 assert 1=======================================

 >
Current Version:
Platform Version: MOCORTM_TEST_W26.03.1_Debug
Project Version:   Fixture_NR_modem
BASE  Version:    5G_MODEM_TEST_W26.03.1
HW Version:        test_modem
01-15-2026 08:00:00

 >
File:  {file}
Line:  {line}
{check}

 > {info}
 >
Current thread info:
 >
    \t                ID:               0x2a
    \t                Name:             {task}
    \t                Last_Err:         0x0
    \t                Queue_Name:       Q_{task[4:] if task.startswith("T_P_") else task[2:]}
    \t                Queue_Total:      100
    \t                Queue_Used:       {queue_used}
    \t                Queue_Available:  {100 - queue_used}

 >
Print R8/R5 PC:
 >
NRCP CORE0 PC=(0x93000dec, 0x93000dec, 0x93000dec)
 >
PSCP CORE0 PC=(0x8043a1e2, 0x8043a1e6, 0x8043a1ea)

 >
Current status is SVC, below is the registers before assert:
 > Current mode:
 >
        R0  = 0x00000011    R1   = 0x0000000f
        R2  = 0x20a3f1c0    R3   = 0x00000000
        R12 = 0x90860000    R13  = 0x20f01e88
        R14 = 0x8043a1d5    PC   = 0x8043a1e2
        SPSR= 0x80000073    CPSR = 0x800000d3
 > IRQ mode:
 >
        R13 = 0x92de9d00    R14  = 0x8ffc849e
        SPSR = 0x60000073
"""
    if dumps:
        out += f"""
 >
=============== Dump All Memory To One File==============
 > ....
Region name:MODEM_Global, start address=0x88000000, Offset=0x00000000, Length=0x00008000
 > ....
Region name:PSCP_LLRAM, start address=0x54100000, Offset=0x00008000, Length=0x00000400
 >  Saving memory data to file:D:\\LogelLogs\\{name}_armlog\\{name}_1.mem; size: 0x00008456 .
 >
Memory Dumping Finished:begin addr=0x88000000,total size=33878Byte(0x8456)
 >
=============== Dump G/W/T/L RFIC Register start==============
 > .... Saving memory data to file:D:\\LogelLogs\\{name}_armlog\\{name}_2.mem; size: 0x00000400 .
 >
=============== Dump G/W/T/L RFIC Register finish==============
"""
    out += """
 >
===============Allocated memory info(in block pool)===============
 >
\tNo.      Size     Entity_ID    FileName (Line)
 >
\t1        18       ENTITY_USER  threadx_os.c (Line 1331)(addr  0x917240dc )
 >
\t2        40       ENTITY_STACK nrrc_cell_select.c (Line 902)(addr  0x917240e0 )
 >
\t3        40       ENTITY_STACK nrrc_cell_select.c (Line 902)(addr  0x91724110 )
 >
===============Allocated memory info(in byte pool)===============
 >
\t1        4106     OSA_ByteHeap threadx_os.c (Line 724)(addr  0x9134d014 )
"""
    if corrupt:
        out += """ >
memory is corrupted, abnormal termination
"""
    return out


def armlog_files(name, session=None, pc_start_ms=PC_START_MS, crash=None):
    """The files Logel saves for one capture; without a session there is no .logel.
    crash: None, "assert" (a modem fault in NR RRC) or "forced" (an assert asked for by AT command)."""
    empty_pcap = struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
    files = {
        f"{name}.cap": build_pcap(pc_start_ms),
        f"{name}_lte.cap": empty_pcap,
        f"{name}_mux.cap": empty_pcap,
        f"{name}_bt.cap": b"",
        f"{name}.iq": b"",
        f"{name}.lst": b"Start Logging[LittleEndian]\r\nModem Version: TEST_MODEM_1.0\r\nTool Version: R9.0.0.0\r\nStop Logging\r\n",
        f"{name}_modem.ini": b"[Modem Version]\r\nPlatformVersion=MOCORTM_TEST\r\nProjectVersion=Fixture_NR_modem\r\nHWVersion=test_modem\r\n",
        f"{name}_log_stat.txt": b"[Lost Statistics]\r\nPS Total package=12\r\nPS Channel lost count=0\r\nTotal lost=0.00\r\nTotal lost count=0\r\nTotal package=12\r\n",
        f"{name}_lte.csv": b"LTE, SIM ID, UE time, EARFCN(Band), PCID, RSRP, SINR\r\n",
        f"{name}_bookmark.xml": b'<?xml version="1.0" ?>\r\n<Bookmark Version="1.0" BugID="">\r\n    <Summary></Summary>\r\n</Bookmark>\r\n',
        f"{name}/msgview.dat": bytes(4096),
        f"{name}/msgview.pbs": logel_header(b"MSG ", pc_start_ms + 3000, START_TICK + 3000) + bytes(512),
    }
    if not session:
        return files
    last = last_tick(session)
    tick = last + 450
    when = clock(pc_start_ms + tick - START_TICK)
    lines = [(START_TICK + k * 200, f"NRRC: serving cell pci {101 + k % 2} rsrp -88 dBm") for k in range((last - START_TICK) // 200 + 1)]
    lines.insert(2, (START_TICK + 300, "NRRC: assert check passed for SIB1 of cell 101"))
    spec = None
    if crash == "assert":
        record = unisoc_record(name, "nrrc_cell_select.c", 1187, "SCI_ASSERT(cell_idx < NRRC_MAX_CELL_NUM)",
                               "invalid cell index 17 while reading SIB1", "T_NRRC", queue_used=97, corrupt=True)
        ps = "Assertion: TXAS_SystemAssert Modem Assert: T_NRRC PS CP assert in file nrrc_cell_select.c line 1187 exp=cell_idx < NRRC_MAX_CELL_NUM info=[invalid cell index 17 while reading SIB1]"
        spec = {"tick": tick, "record": record, "lines": [ps],
                "phy": "Assertion: TXAS_SystemAssert Modem Assert:  NR PHY assert in file threadx_assert.c line 6169 exp=0 info=[]"}
        lines += [(tick, ps), (tick + 2, "OS: modem crash, saving the memory dump")]
        files[f"{name}.ass"] = record.replace("\n", "\r\n").encode()
        # the memory dump: a memory image, so the firmware's text is in it, and its list of recent asserts
        junk = bytes((k * 37 + 11) % 251 for k in range(32768))
        files[f"{name}_1.mem"] = (b"\x78\x56\x34\x12\x01\x00\x00\x00" + junk[:9000] + b"\x00psAssert %s\x00Watch Dog Timer Expired.\x00Recently 10 Assert Informations:\x00"
                                  b"Modem Assert: T_NRRC PS CP assert in file nrrc_cell_select.c line 1187 exp=cell_idx < NRRC_MAX_CELL_NUM info=[invalid cell index 17 while reading SIB1]\x00"
                                  b"Modem Assert:  PS CP assert in file smp.c line 167 exp=0 info=[]\x00" + junk[9000:])
        files[f"{name}_2.mem"] = b"RFICDEBG\x01\x00\x00\x00" + bytes(1012)
    elif crash == "forced":
        record = unisoc_record(name, "atc_basic_cmd.c", 26348, "PASSERT(FALSE)", "Assert by AT+SPATASSERT", "T_P_ATC", dumps=False)
        ps = "Assertion: TXAS_SystemAssert Modem Assert: T_P_ATC PS CP assert in file atc_basic_cmd.c line 26348 exp=FALSE info=[Assert by AT+SPATASSERT]"
        spec = {"tick": tick, "record": record, "lines": [ps]}
        lines += [(tick - 5, "ATC: ATC_RecNewLineSig,link_id:2,sim:0,len:16,line:AT+SPATASSERT=1"), (tick, ps)]
    logel, ps_packets = build_logel(session, pc_start_ms, spec)
    files[f"{name}.logel"] = logel
    # Logel's clock: the PC time of the tick its sync packet gives (3 s into the log)
    dat, pbs = traceview(sorted(lines), ps_packets, (pc_start_ms + 3000, START_TICK + 3000))
    files[f"{name}/traceview.dat"] = dat
    files[f"{name}/traceview.pbs"] = pbs
    return files


def main(out_path, multi=False):
    samples = json.loads((ROOT / "src" / "data" / "samples.json").read_text(encoding="utf-8"))
    sessions = {s["id"]: s for s in samples["sessions"]}
    folders = {f"{NAME}_armlog": armlog_files(NAME, sessions["nr-sa-slice-reject"])}
    if multi:
        hour = 3_600_000
        folders["2026_01_15_10_14_00_000_armlog"] = armlog_files("2026_01_15_10_14_00_000", sessions["nr-sa-pdu-fail"], PC_START_MS + hour, crash="forced")
        folders["2026_01_15_11_14_00_000_armlog"] = armlog_files("2026_01_15_11_14_00_000", None, PC_START_MS + 2 * hour)
        folders["2026_01_15_12_14_00_000_armlog"] = armlog_files("2026_01_15_12_14_00_000", sessions["nr-sa-slice-reject"], PC_START_MS + 3 * hour, crash="assert")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, files in folders.items():
            for name, data in files.items():
                z.writestr(f"{folder}/{name}", data)
    print(out_path)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0] if args else str(ROOT / "build" / "fixtures" / "armlog_fixture.zip"), multi="--multi" in sys.argv)
