"""Engine tests. Run: .venv/Scripts/python -m unittest discover -s decoder/tests -v"""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import engine  # noqa: E402
from engine import radio  # noqa: E402
from engine.hexinput import parse_records, hints_from_header  # noqa: E402

with open(os.path.join(ROOT, "samples.json"), encoding="utf-8") as fh:
    LIB = json.load(fh)
SINGLE = {s["id"]: s for s in LIB["single"]}
SESSIONS = {s["id"]: s for s in LIB["sessions"]}


def decode_one(text, protocol="auto"):
    return engine.decode_text(text, protocol)["messages"][0]["result"]


class Detection(unittest.TestCase):
    def test_every_sample_detects_without_hints(self):
        for s in LIB["single"]:
            with self.subTest(sample=s["id"]):
                r = decode_one(s["hex"])
                self.assertTrue(r["ok"], r.get("error"))
                self.assertEqual(r["protocol"]["id"], s["protocol"])

    def test_manual_protocol_is_respected(self):
        r = decode_one(SINGLE["lte-reject"]["hex"], "lte-rrc.dl-ccch")
        self.assertEqual(r["detection"]["mode"], "manual")
        self.assertEqual(r["message"]["name"], "rrcConnectionReject")

    def test_wrong_manual_protocol_reports_error_or_warning(self):
        r = decode_one(SINGLE["5gs-reg-reject"]["hex"], "lte-rrc.ul-dcch")
        self.assertTrue(not r["ok"] or r["warnings"])

    def test_garbage_is_not_claimed(self):
        r = decode_one("FF FF FF FF FF FF FF FF FF FF FF FF")
        self.assertFalse(r["ok"] and r["detection"]["confidence"] == "high")


class Analysis(unittest.TestCase):
    def test_attach_reject_cause(self):
        r = decode_one(SINGLE["eps-attach-reject"]["hex"])
        codes = {f.get("code") for f in r["findings"]}
        self.assertIn(19, codes)   # EMM ESM failure
        self.assertIn(27, codes)   # ESM missing or unknown APN
        self.assertEqual(r["status"], "failure")

    def test_measurement_report_values(self):
        r = decode_one(SINGLE["lte-mr-weak"]["hex"])
        serving = r["facts"]["serving"]
        self.assertEqual(serving["rsrp"], -114)   # RSRP_27 -> -114 dBm lower bound
        self.assertTrue(any(f["title"] == "Weak serving coverage" for f in r["findings"]))

    def test_nested_nas_in_rrc(self):
        r = decode_one(SINGLE["lte-setup-complete"]["hex"])
        self.assertEqual(r["embedded"][0]["result"]["message"]["title"], "Attach Request")

    def test_endc_container(self):
        r = decode_one(SINGLE["lte-endc"]["hex"])
        emb = [e["result"] for e in r["embedded"]]
        self.assertTrue(any(e["protocol"]["id"] == "nr-rrc.rrc-reconfiguration" and e["ok"] for e in emb))

    def test_pdu_session_reject_inside_transport(self):
        r = decode_one(SINGLE["5gs-pdu-reject"]["hex"])
        self.assertIn(27, {f.get("code") for f in r["findings"]})

    def test_ip_and_apn(self):
        r = decode_one(SINGLE["eps-attach-accept"]["hex"])
        hl = {h["label"]: h["value"] for h in r["highlights"]}
        self.assertEqual(hl.get("APN"), "internet")
        self.assertEqual(hl.get("PDN address"), "10.45.0.2")


class Sessions(unittest.TestCase):
    EXPECT = {"lte-attach-ok": "ok", "lte-ho-drop": "failure", "nr-sa-slice-reject": "failure",
              "nr-sa-pdu-fail": "failure", "endc-scg-fail": "failure"}

    def test_verdicts(self):
        for sid, verdict in self.EXPECT.items():
            with self.subTest(session=sid):
                rep = engine.decode_text(SESSIONS[sid]["text"])
                self.assertEqual(rep["session"]["verdict"], verdict)

    def test_handover_failure_root_cause(self):
        rep = engine.decode_text(SESSIONS["lte-ho-drop"]["text"])
        self.assertEqual(rep["session"]["narrative"]["root"]["title"], "Handover to PCI 101 failed")

    def test_attach_procedures_complete(self):
        rep = engine.decode_text(SESSIONS["lte-attach-ok"]["text"])
        procs = {p["id"]: p["status"] for p in rep["session"]["procedures"]}
        self.assertEqual(procs.get("eps-attach"), "success")
        self.assertEqual(procs.get("lte-rrc-setup"), "success")


class Input(unittest.TestCase):
    HEX = SINGLE["lte-reject"]["hex"].replace(" ", "")

    def test_formats(self):
        b = bytes.fromhex(self.HEX)
        variants = [
            self.HEX,
            self.HEX.lower(),
            " ".join(f"0x{x:02X}" for x in b),
            ",".join(f"0x{x:02x}" for x in b),
            "0000: " + " ".join(f"{x:02X}" for x in b) + "   ....",
        ]
        for v in variants:
            with self.subTest(v=v):
                recs = parse_records(v)
                self.assertEqual(len(recs), 1)
                self.assertEqual(recs[0]["bytes"], b)

    def test_wrapped_single_message(self):
        h = SINGLE["lte-cap"]["hex"].replace(" ", "")
        lines = [h[i:i + 32] for i in range(0, len(h), 32)]
        recs = parse_records("\n".join(lines))
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["bytes"], bytes.fromhex(h))

    def test_header_lines(self):
        text = "10:01:02.123 LTE RRC DL_CCCH RRCConnectionReject: " + SINGLE["lte-reject"]["hex"]
        recs = parse_records(text)
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["timestamp"], "10:01:02.123")
        hints = hints_from_header(recs[0]["header"])
        self.assertEqual(hints.get("channel"), "DL-CCCH")
        self.assertEqual(hints.get("rat"), "LTE")

    def test_one_message_per_line(self):
        text = "\n".join([SINGLE["eps-attach-reject"]["hex"], SINGLE["5gs-reg-reject"]["hex"]])
        self.assertEqual(len(parse_records(text)), 2)


class Radio(unittest.TestCase):
    def test_earfcn(self):
        info = radio.earfcn_info(1300)
        self.assertEqual(info["band"], 3)
        self.assertAlmostEqual(info["freq"], 1815.0)
        self.assertEqual(radio.earfcn_info(39150)["band"], 40)

    def test_nrarfcn(self):
        info = radio.nrarfcn_info(632544)
        self.assertAlmostEqual(info["freq"], 3488.16, places=2)
        self.assertEqual(info["bands"][0], 78)

    def test_measurement_mapping(self):
        self.assertEqual(radio.lte_rsrp(45)[0], -96)
        self.assertEqual(radio.nr_rsrp(57)[0], -100)
        self.assertEqual(radio.nr_rsrq(70)[0], -8.5)

    def test_plmn(self):
        self.assertIn("Jio", radio.plmn_text("405", "857"))
        self.assertEqual(radio.plmn_from_bytes(bytes.fromhex("00F110")), ("001", "01"))


def capture_of(session_id, **extra):
    """A capture as the browser builds it from a .logel: each message with its logged channel."""
    lines = SESSIONS[session_id]["text"].splitlines()
    recs = []
    for head, hexline in zip(lines, lines[1:]):
        parts = head.split()
        if len(parts) >= 4 and ":" in parts[0] and parts[2] == "RRC":
            recs.append({"ts": parts[0], "protocol": "nr-rrc." + parts[3].lower().replace("_", "-"),
                         "hex": hexline.replace(" ", ""), "header": "NR RRC, modem log"})
    cap = {"name": "test", "kind": "zip", "records": recs, "radio": [], "at": [], "device": {}}
    cap.update(extra)
    return cap


class Capture(unittest.TestCase):
    def test_logged_channel_is_trusted(self):
        rep = engine.decode_capture(capture_of("nr-sa-slice-reject"))
        self.assertTrue(all(m["result"]["ok"] for m in rep["messages"]))
        self.assertTrue(all(m["result"]["detection"]["mode"] == "log" for m in rep["messages"]))
        self.assertEqual(rep["session"]["verdict"], "failure")
        self.assertIn("#62", rep["session"]["narrative"]["root"]["title"])

    def test_at_answers_radio_and_dns(self):
        cap = capture_of(
            "nr-sa-slice-reject",
            at=[{"ts": "09:14:02.600", "line": '+COPS: 0,0,"Test Net",11'},
                {"ts": "09:14:02.700", "line": "+CESQ: 99,99,255,255,255,255,70,86,76"},
                {"ts": "09:14:02.800", "line": '+C5GREG: 2,1,"0016","840484001",11,9,01.000001'}],
            radio=[{"ts": "09:14:02.100", "rsrp": -71.2, "pci": 952, "arfcn": 634080},
                   {"ts": "09:14:02.200", "sinr": 20.3}],
            ip={"dns": [{"ts": "09:14:03.000", "name": "bad.example", "type": "A", "rcode": 3, "answers": 0, "answered": True}]},
        )
        s = engine.decode_capture(cap)["session"]
        modem = s["radio"]["modem"]
        self.assertEqual(modem["rsrp"]["n"], 2)  # trace sample + AT+CESQ (-157 + 86 = -71 dBm)
        self.assertIn(-71, [p.get("rsrp") for p in modem["points"]])
        self.assertEqual(modem["sinr"]["max"], 20.3)
        self.assertEqual(modem["cells"][0]["band"], 78)
        net = {r["label"]: r["value"] for r in s["context"]["network"]}
        self.assertEqual(net["Operator"], "Test Net")
        titles = [f["title"] for f in s["findings"]]
        self.assertTrue(any("DNS lookup failed for bad.example" in t for t in titles))

    def test_registration_denied_only_confirms(self):
        at = [{"ts": "09:14:03.000", "line": "+C5GREG: 2,3"}]
        s = engine.decode_capture(capture_of("nr-sa-slice-reject", at=at))["session"]
        self.assertFalse(any(f.get("source") == "AT" for f in s["findings"] if f["severity"] == "critical"))
        s2 = engine.decode_capture(capture_of("lte-attach-ok", at=at, records=[]))
        self.assertIsNone(s2["session"])

    def test_same_nas_twice_is_one_attempt(self):
        nas = SINGLE["5gs-reg-req"]["hex"]
        recs = [{"ts": "10:00:00.000", "protocol": "nas.5gs", "hex": nas, "header": "5GS NAS"},
                {"ts": "10:00:00.180", "protocol": "nas.5gs", "hex": nas, "header": "5GS NAS"}]
        s = engine.decode_capture({"name": "t", "records": recs})["session"]
        regs = [p for p in s["procedures"] if p["id"] == "5gs-reg"]
        self.assertEqual(len(regs), 1)
        self.assertNotEqual(regs[0]["status"], "retried")


ASSERT_EVENT = {"file": "modem_assert.ass", "kind": "assert", "title": "Modem assert in NR RRC (nrrc_cell.c line 1187)",
                "where": "nrrc_cell.c line 1187", "source": "ps/nrrc/nrrc_cell.c", "line": 1187,
                "module": "NR RRC (5G radio resource control)", "expression": "cell_idx < NRRC_MAX_CELL", "task": "NRRC",
                "ts": "09:14:02.950", "registers": [], "stack": [], "raw": ""}


class Crashes(unittest.TestCase):
    def test_assert_is_the_root_cause(self):
        cap = capture_of("nr-sa-slice-reject", crashes={"events": [ASSERT_EVENT], "groups": [], "searched": ["a"], "lines": 0})
        s = engine.decode_capture(cap)["session"]
        root = s["narrative"]["root"]
        self.assertEqual(root["title"], ASSERT_EVENT["title"])
        crash = next(f for f in s["findings"] if f.get("category") == "crash")
        self.assertIn("cell_idx < NRRC_MAX_CELL", crash["detail"])
        self.assertIn("task NRRC", crash["detail"])
        # it points at the last message logged before it
        msgs = engine.decode_capture(cap)["messages"]
        self.assertTrue(crash["refs"])
        self.assertLessEqual(msgs[crash["refs"][0]]["timestamp"], "09:14:02.950")
        # the procedure that failed before it is still reported
        self.assertTrue(any(f.get("category") != "crash" and f["severity"] == "critical" for f in s["findings"]))

    def test_assert_without_messages_still_reports(self):
        rep = engine.decode_capture({"name": "t", "records": [], "crashes": {"events": [ASSERT_EVENT], "groups": [], "searched": ["a"], "lines": 0}})
        self.assertEqual(rep["session"]["verdict"], "failure")
        self.assertEqual(rep["capture"]["crashes"]["events"][0]["task"], "NRRC")

    def test_crash_lines_without_a_record(self):
        groups = [{"kind": "watchdog", "strong": True, "text": "WDT timeout: task L1C not fed", "files": {"x.logel": 3},
                   "count": 3, "first": "09:14:01.000", "last": "09:14:02.000"},
                  {"kind": "assert", "strong": True, "text": "SCI_ASSERT nrrc_cell.c 1187", "files": {"traceview.dat": 1},
                   "count": 1, "first": "09:14:02.940", "last": "09:14:02.940"}]
        s = engine.decode_capture(capture_of("nr-sa-slice-reject", crashes={"events": [ASSERT_EVENT], "groups": groups,
                                                                           "searched": ["a"], "lines": 4}))["session"]
        crash = [f for f in s["findings"] if f.get("category") == "crash"]
        # the trace line naming the record's source file is the same assert: not reported twice
        self.assertEqual(len(crash), 2)
        self.assertEqual(s["narrative"]["root"]["title"], "The modem watchdog fired")  # it came first

    def test_nothing_found_is_said(self):
        groups = [{"kind": "assert", "strong": False, "text": "assert check passed", "files": {"a": 1}, "count": 1, "first": None, "last": None}]
        s = engine.decode_capture(capture_of("lte-attach-ok", crashes={"events": [], "groups": groups, "searched": ["a", "b"], "lines": 1}))["session"]
        ok = [f for f in s["findings"] if f.get("category") == "crash"]
        self.assertEqual(ok[0]["severity"], "ok")
        self.assertIn("2 files were searched", ok[0]["detail"])


if __name__ == "__main__":
    unittest.main()
