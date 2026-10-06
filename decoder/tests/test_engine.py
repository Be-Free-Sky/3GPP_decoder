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


if __name__ == "__main__":
    unittest.main()
