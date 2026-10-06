"""Build the sample library (valid, spec-encoded messages and realistic sessions).

RRC messages are encoded with pycrate from explicit values, so every hex string
is guaranteed to be valid. NAS messages are hand-built from TS 24.301 / 24.501
octet layouts and verified by decoding them back.

Run:  .venv/Scripts/python decoder/tools/build_samples.py
Writes: decoder/samples.json
"""

import contextlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

with contextlib.redirect_stdout(io.StringIO()):
    from pycrate_asn1dir import RRCLTE, RRCNR
    import engine

L = RRCLTE.EUTRA_RRC_Definitions
N = RRCNR.NR_RRC_Definitions


def enc(obj, val):
    obj.set_val(val)
    return obj.to_uper().hex().upper()


def plmn(mcc, mnc):
    return {"mcc": [int(d) for d in mcc], "mnc": [int(d) for d in mnc]}


def nest_nce(leaf, depth):
    """Wrap `leaf` in `depth` levels of nonCriticalExtension."""
    v = leaf
    for _ in range(depth):
        v = {"nonCriticalExtension": v}
    return v


def spaced(h):
    return " ".join(h[i:i + 2] for i in range(0, len(h), 2))


# ---------------------------------------------------------------------------
# NAS (hex, verified below)
# ---------------------------------------------------------------------------

APN_INTERNET = "08696E7465726E6574"          # "internet" in APN label format
PDU_ACCEPT = ("2E0101C2" + "11" + "0006" + "01000330FF01" + "06060064060064" + "2905010A2D0003" + "220101" +
              "2509" + APN_INTERNET)
NAS = {
    "attach_request": "0741720809101010325476980" + "2E0E0" + "00040201D031",
    "attach_reject_15": "07440F",
    "attach_reject_19": "074413780004" + "0201D11B",
    "auth_request": "075200" + "A1B2C3D4E5F60718293A4B5C6D7E8F90" + "10" + "0F1E2D3C4B5A69788796A5B4C3D2E1F0",
    "auth_response": "075308" + "1122334455667788",
    "auth_failure_20": "075C14",
    "auth_failure_21": "075C15300E" + "0102030405060708090A0B0C0D0E",
    "smc_eps": "37A1B2C3D400" + "075D2200" + "02E0E0" + "C1",
    "smc_complete_eps": "47A1B2C3D401" + "075E",
    "attach_accept": ("0742" + "02" + "49" + "06" + "0000F1100001" + "0015" +
                      "5201C1" + "0109" + "09" + APN_INTERNET + "05010A2D0002" +
                      "500BF600F11080010" + "1C0FFEE01" + "640101"),
    "attach_complete": "0743" + "0003" + "5200C2",
    "tau_reject_9": "074B09",
    "service_reject_22": "074E16" + "5F0122",
    "detach_mt": "074501" + "530A",
    "identity_request": "075501",
    "pdn_reject_33": "0201D121",
    "pdn_reject_27": "0201D11B",
    "act_dedi_qci1": "6200C5" + "05" + "05013F3F3F3F" + "07" + "21310003" + "5013C4",
    "esm_info_request": "0201D9",
    "emm_status_98": "076062",
    # 5GS
    "reg_request": "7E004179000D0100F110F0FF000021436587092E02E0E0",
    "reg_reject_62": "7E00443E",
    "reg_reject_11": "7E00440B",
    "reg_reject_7": "7E004407",
    "reg_accept": ("7E0042" + "0101" + "77000BF200F110010041C0FFEE02" + "54070000F110000001" +
                   "1502" + "0101" + "21" + "0101" + "5E0106"),
    "reg_complete": "7E0043",
    "smc_5gs": "7E03A1B2C3D400" + "7E005D220002E0E0E1",
    "smc_complete_5gs": "7E04A1B2C3D401" + "7E005E",
    "auth_request_5gs": "7E005600" + "0200 00".replace(" ", "") + "21" + "A1B2C3D4E5F60718293A4B5C6D7E8F90" + "2010" +
                        "0F1E2D3C4B5A69788796A5B4C3D2E1F0",
    "auth_failure_5gs_20": "7E005914",
    "ul_nas_pdu_req": ("7E0067" + "01" + "0007" + "2E0101C1FFFF91" + "1201" + "81" + "220101" + "2509" + APN_INTERNET),
    "dl_nas_pdu_reject_27": "7E0068" + "01" + "0005" + "2E0101C31B" + "1201",
    "dl_nas_pdu_accept": ("7E0068" + "01" + f"{len(PDU_ACCEPT) // 2:04X}" + PDU_ACCEPT + "1201"),
    "service_reject_5gs_22": "7E004D16",
    "dereg_mt": "7E004703" + "5807".replace("5807", "580B"),
    "fgmm_status": "7E006462",
}


# ---------------------------------------------------------------------------
# LTE RRC
# ---------------------------------------------------------------------------

def lte_samples():
    s = {}
    s["mib"] = enc(L.BCCH_BCH_Message, {"message": {"dl-Bandwidth": "n100", "phich-Config": {
        "phich-Duration": "normal", "phich-Resource": "one"}, "systemFrameNumber": (0x5A, 8),
        "schedulingInfoSIB1-BR-r13": 0, "systemInfoUnchanged-BR-r15": False,
        "partEARFCN-r17": ("spare", (0, 2)), "spare": (0, 1)}})
    s["sib1"] = enc(L.BCCH_DL_SCH_Message, {"message": ("c1", ("systemInformationBlockType1", {
        "cellAccessRelatedInfo": {
            "plmn-IdentityList": [{"plmn-Identity": plmn("405", "857"), "cellReservedForOperatorUse": "notReserved"}],
            "trackingAreaCode": (0x2A1F, 16), "cellIdentity": (0x1E2F301, 28), "cellBarred": "notBarred",
            "intraFreqReselection": "allowed", "csg-Indication": False},
        "cellSelectionInfo": {"q-RxLevMin": -64},
        "freqBandIndicator": 3,
        "schedulingInfoList": [{"si-Periodicity": "rf16", "sib-MappingInfo": []},
                               {"si-Periodicity": "rf32", "sib-MappingInfo": ["sibType3", "sibType5"]}],
        "si-WindowLength": "ms20", "systemInfoValueTag": 4}))})
    s["sib2_barring"] = enc(L.BCCH_DL_SCH_Message, {"message": ("c1", ("systemInformation", {"criticalExtensions": (
        "systemInformation-r8", {"sib-TypeAndInfo": [("sib3", {
            "cellReselectionInfoCommon": {"q-Hyst": "dB4"},
            "cellReselectionServingFreqInfo": {"threshServingLow": 6, "cellReselectionPriority": 5},
            "intraFreqCellReselectionInfo": {"q-RxLevMin": -64, "s-IntraSearch": 31, "presenceAntennaPort1": True,
                                             "neighCellConfig": (1, 2), "t-ReselectionEUTRA": 1}})]})}))})
    s["rrc_conn_req"] = enc(L.UL_CCCH_Message, {"message": ("c1", ("rrcConnectionRequest", {"criticalExtensions": (
        "rrcConnectionRequest-r8", {"ue-Identity": ("s-TMSI", {"mmec": (0x21, 8), "m-TMSI": (0xC0FFEE01, 32)}),
                                    "establishmentCause": "mo-Data", "spare": (0, 1)})}))})
    s["rrc_conn_req_attach"] = enc(L.UL_CCCH_Message, {"message": ("c1", ("rrcConnectionRequest", {"criticalExtensions": (
        "rrcConnectionRequest-r8", {"ue-Identity": ("randomValue", (0x1A2B3C4D5E, 40)),
                                    "establishmentCause": "mo-Signalling", "spare": (0, 1)})}))})
    s["rrc_conn_setup"] = enc(L.DL_CCCH_Message, {"message": ("c1", ("rrcConnectionSetup", {
        "rrc-TransactionIdentifier": 0, "criticalExtensions": ("c1", ("rrcConnectionSetup-r8", {
            "radioResourceConfigDedicated": {"srb-ToAddModList": [{"srb-Identity": 1, "rlc-Config": ("defaultValue", 0),
                                                                    "logicalChannelConfig": ("defaultValue", 0)}],
                                             "mac-MainConfig": ("defaultValue", 0)}}))}))})
    s["rrc_conn_setup_complete"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("rrcConnectionSetupComplete", {
        "rrc-TransactionIdentifier": 0, "criticalExtensions": ("c1", ("rrcConnectionSetupComplete-r8", {
            "selectedPLMN-Identity": 1, "dedicatedInfoNAS": bytes.fromhex(NAS["attach_request"])}))}))})
    s["rrc_conn_reject"] = enc(L.DL_CCCH_Message, {"message": ("c1", ("rrcConnectionReject", {"criticalExtensions": (
        "c1", ("rrcConnectionReject-r8", {"waitTime": 10}))}))})
    s["smc"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("securityModeCommand", {
        "rrc-TransactionIdentifier": 1, "criticalExtensions": ("c1", ("securityModeCommand-r8", {
            "securityConfigSMC": {"securityAlgorithmConfig": {"cipheringAlgorithm": "eea2",
                                                              "integrityProtAlgorithm": "eia2"}}}))}))})
    s["smc_complete"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("securityModeComplete", {
        "rrc-TransactionIdentifier": 1, "criticalExtensions": ("securityModeComplete-r8", {})}))})
    s["cap_enquiry"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("ueCapabilityEnquiry", {
        "rrc-TransactionIdentifier": 2, "criticalExtensions": ("c1", ("ueCapabilityEnquiry-r8", {
            "ue-CapabilityRequest": ["eutra", "nr", "eutra-nr"]}))}))})
    uecap = {"accessStratumRelease": "rel15", "ue-Category": 4,
             "pdcp-Parameters": {"supportedROHC-Profiles": {k + "-r15": False for k in (
                 "profile0x0001", "profile0x0002", "profile0x0003", "profile0x0004", "profile0x0006",
                 "profile0x0101", "profile0x0102", "profile0x0103", "profile0x0104")} | {}},
             "phyLayerParameters": {"ue-TxAntennaSelectionSupported": False, "ue-SpecificRefSigsSupported": True},
             "rf-Parameters": {"supportedBandListEUTRA": [{"bandEUTRA": b, "halfDuplex": False} for b in (1, 3, 5, 8, 28, 40, 41)]},
             "measParameters": {"bandListEUTRA": [{"interFreqBandList": [{"interFreqNeedForGaps": True}] * 7}] * 7},
             "interRAT-Parameters": {}}
    L.UE_EUTRA_Capability.set_val(uecap)
    capbytes = L.UE_EUTRA_Capability.to_uper()
    s["cap_info"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("ueCapabilityInformation", {
        "rrc-TransactionIdentifier": 2, "criticalExtensions": ("c1", ("ueCapabilityInformation-r8", {
            "ue-CapabilityRAT-ContainerList": [{"rat-Type": "eutra", "ueCapabilityRAT-Container": capbytes}]}))}))})
    s["reconfig_meas_drb"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("rrcConnectionReconfiguration", {
        "rrc-TransactionIdentifier": 3, "criticalExtensions": ("c1", ("rrcConnectionReconfiguration-r8", {
            "measConfig": {
                "measObjectToAddModList": [
                    {"measObjectId": 1, "measObject": ("measObjectEUTRA", {"carrierFreq": 1300, "allowedMeasBandwidth": "mbw100",
                                                                            "presenceAntennaPort1": True, "neighCellConfig": (1, 2),
                                                                            "offsetFreq": "dB0"})}],
                "reportConfigToAddModList": [
                    {"reportConfigId": 1, "reportConfig": ("reportConfigEUTRA", {
                        "triggerType": ("event", {"eventId": ("eventA3", {"a3-Offset": 6, "reportOnLeave": False}),
                                                  "hysteresis": 2, "timeToTrigger": "ms320"}),
                        "triggerQuantity": "rsrp", "reportQuantity": "both", "maxReportCells": 4,
                        "reportInterval": "ms480", "reportAmount": "r4"})},
                    {"reportConfigId": 2, "reportConfig": ("reportConfigEUTRA", {
                        "triggerType": ("event", {"eventId": ("eventA2", {"a2-Threshold": ("threshold-RSRP", 29)}),
                                                  "hysteresis": 2, "timeToTrigger": "ms640"}),
                        "triggerQuantity": "rsrp", "reportQuantity": "both", "maxReportCells": 1,
                        "reportInterval": "ms480", "reportAmount": "r1"})}],
                "measIdToAddModList": [{"measId": 1, "measObjectId": 1, "reportConfigId": 1},
                                       {"measId": 2, "measObjectId": 1, "reportConfigId": 2}]},
            "dedicatedInfoNASList": [bytes.fromhex(NAS["attach_accept"])],
            "radioResourceConfigDedicated": {
                "drb-ToAddModList": [{"eps-BearerIdentity": 5, "drb-Identity": 1,
                                      "rlc-Config": ("am", {"ul-AM-RLC": {"t-PollRetransmit": "ms80", "pollPDU": "p128",
                                                                          "pollByte": "kB125", "maxRetxThreshold": "t32"},
                                                            "dl-AM-RLC": {"t-Reordering": "ms80", "t-StatusProhibit": "ms60"}}),
                                      "logicalChannelIdentity": 3,
                                      "logicalChannelConfig": {"ul-SpecificParameters": {
                                          "priority": 13, "prioritisedBitRate": "infinity", "bucketSizeDuration": "ms100",
                                          "logicalChannelGroup": 3}}}]}}))}))})
    s["reconfig_complete"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("rrcConnectionReconfigurationComplete", {
        "rrc-TransactionIdentifier": 3, "criticalExtensions": ("rrcConnectionReconfigurationComplete-r8", {})}))})
    s["reconfig_ho"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("rrcConnectionReconfiguration", {
        "rrc-TransactionIdentifier": 0, "criticalExtensions": ("c1", ("rrcConnectionReconfiguration-r8", {
            "mobilityControlInfo": {"targetPhysCellId": 101, "carrierFreq": {"dl-CarrierFreq": 1850},
                                    "t304": "ms1000", "newUE-Identity": (0x5A3C, 16),
                                    "radioResourceConfigCommon": {
                                        "prach-Config": {"rootSequenceIndex": 22},
                                        "pusch-ConfigCommon": {
                                            "pusch-ConfigBasic": {"n-SB": 1, "hoppingMode": "interSubFrame",
                                                                  "pusch-HoppingOffset": 0, "enable64QAM": False},
                                            "ul-ReferenceSignalsPUSCH": {"groupHoppingEnabled": False, "groupAssignmentPUSCH": 0,
                                                                         "sequenceHoppingEnabled": False, "cyclicShift": 0}},
                                        "ul-CyclicPrefixLength": "len1"}},
            "securityConfigHO": {"handoverType": ("intraLTE", {"keyChangeIndicator": False, "nextHopChainingCount": 1})}}))}))})
    s["meas_report_weak"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("measurementReport", {"criticalExtensions": (
        "c1", ("measurementReport-r8", {"measResults": {
            "measId": 1, "measResultPCell": {"rsrpResult": 27, "rsrqResult": 8},
            "measResultNeighCells": ("measResultListEUTRA", [
                {"physCellId": 101, "measResult": {"rsrpResult": 36, "rsrqResult": 14}},
                {"physCellId": 245, "measResult": {"rsrpResult": 31, "rsrqResult": 10}}])}}))}))})
    s["meas_report_good"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("measurementReport", {"criticalExtensions": (
        "c1", ("measurementReport-r8", {"measResults": {
            "measId": 1, "measResultPCell": {"rsrpResult": 52, "rsrqResult": 24},
            "measResultNeighCells": ("measResultListEUTRA", [
                {"physCellId": 101, "measResult": {"rsrpResult": 58, "rsrqResult": 26}}])}}))}))})
    s["meas_report_interf"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("measurementReport", {"criticalExtensions": (
        "c1", ("measurementReport-r8", {"measResults": {
            "measId": 2, "measResultPCell": {"rsrpResult": 49, "rsrqResult": 7}}}))}))})
    s["reest_req_hof"] = enc(L.UL_CCCH_Message, {"message": ("c1", ("rrcConnectionReestablishmentRequest", {
        "criticalExtensions": ("rrcConnectionReestablishmentRequest-r8", {
            "ue-Identity": {"c-RNTI": (0x4F21, 16), "physCellId": 37, "shortMAC-I": (0xB1C2, 16)},
            "reestablishmentCause": "handoverFailure", "spare": (0, 2)})}))})
    s["reest_req_rlf"] = enc(L.UL_CCCH_Message, {"message": ("c1", ("rrcConnectionReestablishmentRequest", {
        "criticalExtensions": ("rrcConnectionReestablishmentRequest-r8", {
            "ue-Identity": {"c-RNTI": (0x5A3C, 16), "physCellId": 101, "shortMAC-I": (0x77E1, 16)},
            "reestablishmentCause": "otherFailure", "spare": (0, 2)})}))})
    s["reest_reject"] = enc(L.DL_CCCH_Message, {"message": ("c1", ("rrcConnectionReestablishmentReject", {
        "criticalExtensions": ("rrcConnectionReestablishmentReject-r8", {})}))})
    s["release_redirect_geran"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("rrcConnectionRelease", {
        "rrc-TransactionIdentifier": 1, "criticalExtensions": ("c1", ("rrcConnectionRelease-r8", {
            "releaseCause": "other", "redirectedCarrierInfo": ("geran", {"startingARFCN": 62, "bandIndicator": "dcs1800",
                                                                          "followingARFCNs": ("explicitListOfARFCNs", [64, 70])})}))}))})
    s["release_normal"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("rrcConnectionRelease", {
        "rrc-TransactionIdentifier": 2, "criticalExtensions": ("c1", ("rrcConnectionRelease-r8", {
            "releaseCause": "other"}))}))})
    s["ul_info_transfer"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("ulInformationTransfer", {"criticalExtensions": (
        "c1", ("ulInformationTransfer-r8", {"dedicatedInfoType": ("dedicatedInfoNAS", bytes.fromhex(NAS["auth_failure_20"]))}))}))})
    s["dl_info_transfer_auth"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("dlInformationTransfer", {
        "rrc-TransactionIdentifier": 0, "criticalExtensions": ("c1", ("dlInformationTransfer-r8", {
            "dedicatedInfoType": ("dedicatedInfoNAS", bytes.fromhex(NAS["auth_request"]))}))}))})
    s["ul_info_transfer_auth_resp"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("ulInformationTransfer", {"criticalExtensions": (
        "c1", ("ulInformationTransfer-r8", {"dedicatedInfoType": ("dedicatedInfoNAS", bytes.fromhex(NAS["auth_response"]))}))}))})
    s["dl_info_transfer_smc"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("dlInformationTransfer", {
        "rrc-TransactionIdentifier": 0, "criticalExtensions": ("c1", ("dlInformationTransfer-r8", {
            "dedicatedInfoType": ("dedicatedInfoNAS", bytes.fromhex(NAS["smc_eps"]))}))}))})
    s["ul_info_transfer_smc_complete"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("ulInformationTransfer", {"criticalExtensions": (
        "c1", ("ulInformationTransfer-r8", {"dedicatedInfoType": ("dedicatedInfoNAS", bytes.fromhex(NAS["smc_complete_eps"]))}))}))})
    s["ul_info_transfer_attach_complete"] = enc(L.UL_DCCH_Message, {"message": ("c1", ("ulInformationTransfer", {"criticalExtensions": (
        "c1", ("ulInformationTransfer-r8", {"dedicatedInfoType": ("dedicatedInfoNAS", bytes.fromhex(NAS["attach_complete"]))}))}))})
    s["paging"] = enc(L.PCCH_Message, {"message": ("c1", ("paging", {"pagingRecordList": [
        {"ue-Identity": ("s-TMSI", {"mmec": (0x21, 8), "m-TMSI": (0xC0FFEE01, 32)}), "cn-Domain": "ps"}]}))})
    s["scg_failure_nr"] = enc(L.UL_DCCH_Message, {"message": ("messageClassExtension", ("c2", (
        "scgFailureInformationNR-r15", {"criticalExtensions": ("c1", ("scgFailureInformationNR-r15", {
            "failureReportSCG-NR-r15": {"failureType-r15": "randomAccessProblem",
                                        "measResultFreqListNR-r15": [{"carrierFreq-r15": 632544}]}}))})))})
    v1510 = {"nr-Config-r15": ("setup", {"endc-ReleaseAndAdd-r15": False,
                                         "nr-SecondaryCellGroupConfig-r15": NR_SCG_BYTES}),
             "sk-Counter-r15": 0}
    s["reconfig_endc"] = enc(L.DL_DCCH_Message, {"message": ("c1", ("rrcConnectionReconfiguration", {
        "rrc-TransactionIdentifier": 1, "criticalExtensions": ("c1", ("rrcConnectionReconfiguration-r8",
                                                                      nest_nce(v1510, 8)))}))})
    return s


# ---------------------------------------------------------------------------
# NR RRC
# ---------------------------------------------------------------------------

def nr_scg_reconfig():
    N.RRCReconfiguration.set_val({"rrc-TransactionIdentifier": 0, "criticalExtensions": ("rrcReconfiguration", {
        "secondaryCellGroup": ("CellGroupConfig", {
            "cellGroupId": 1,
            "spCellConfig": {"servCellIndex": 1, "reconfigurationWithSync": {
                "spCellConfigCommon": {"physCellId": 412, "downlinkConfigCommon": {
                    "frequencyInfoDL": {"absoluteFrequencySSB": 632544, "frequencyBandList": [78],
                                        "absoluteFrequencyPointA": 631008,
                                        "scs-SpecificCarrierList": [{"offsetToCarrier": 0, "subcarrierSpacing": "kHz30",
                                                                     "carrierBandwidth": 273}]}},
                    "ss-PBCH-BlockPower": 15, "dmrs-TypeA-Position": "pos2"},
                "newUE-Identity": 17921, "t304": "ms2000"}}})})})
    return N.RRCReconfiguration.to_uper()


NR_SCG_BYTES = None


def nr_samples():
    s = {}
    s["mib"] = enc(N.BCCH_BCH_Message, {"message": ("mib", {"systemFrameNumber": (0x2A, 6),
                                                            "subCarrierSpacingCommon": "scs30or120",
                                                            "ssb-SubcarrierOffset": 6, "dmrs-TypeA-Position": "pos2",
                                                            "pdcch-ConfigSIB1": {"controlResourceSetZero": 12, "searchSpaceZero": 0},
                                                            "cellBarred": "notBarred", "intraFreqReselection": "allowed",
                                                            "spare": (0, 1)})})
    s["sib1"] = enc(N.BCCH_DL_SCH_Message, {"message": ("c1", ("systemInformationBlockType1", {
        "cellSelectionInfo": {"q-RxLevMin": -64},
        "cellAccessRelatedInfo": {"plmn-IdentityInfoList": [{
            "plmn-IdentityList": [plmn("405", "857")], "trackingAreaCode": (0x00A1F2, 24),
            "cellIdentity": (0x0F1A2B3C4, 36), "cellReservedForOperatorUse": "notReserved"}]}}))})
    s["setup_req"] = enc(N.UL_CCCH_Message, {"message": ("c1", ("rrcSetupRequest", {"rrcSetupRequest": {
        "ue-Identity": ("ng-5G-S-TMSI-Part1", (0x41C0FFEE02 & ((1 << 39) - 1), 39)),
        "establishmentCause": "mo-Signalling", "spare": (0, 1)}}))})
    s["setup"] = enc(N.DL_CCCH_Message, {"message": ("c1", ("rrcSetup", {"rrc-TransactionIdentifier": 0,
        "criticalExtensions": ("rrcSetup", {"radioBearerConfig": {"srb-ToAddModList": [{"srb-Identity": 1}]},
                                            "masterCellGroup": ("CellGroupConfig", {"cellGroupId": 0,
                                                                                    "rlc-BearerToAddModList": [{
                                                                                        "logicalChannelIdentity": 1,
                                                                                        "servedRadioBearer": ("srb-Identity", 1)}],
                                                                                    "spCellConfig": {}})})}))})
    s["setup_complete"] = enc(N.UL_DCCH_Message, {"message": ("c1", ("rrcSetupComplete", {"rrc-TransactionIdentifier": 0,
        "criticalExtensions": ("rrcSetupComplete", {"selectedPLMN-Identity": 1,
                                                    "dedicatedNAS-Message": bytes.fromhex(NAS["reg_request"])})}))})
    s["reject"] = enc(N.DL_CCCH_Message, {"message": ("c1", ("rrcReject", {"criticalExtensions": ("rrcReject", {"waitTime": 16})}))})
    s["smc"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("securityModeCommand", {"rrc-TransactionIdentifier": 1,
        "criticalExtensions": ("securityModeCommand", {"securityConfigSMC": {"securityAlgorithmConfig": {
            "cipheringAlgorithm": "nea2", "integrityProtAlgorithm": "nia2"}}})}))})
    s["dl_info_smc"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("dlInformationTransfer", {"rrc-TransactionIdentifier": 0,
        "criticalExtensions": ("dlInformationTransfer", {"dedicatedNAS-Message": bytes.fromhex(NAS["smc_5gs"])})}))})
    s["ul_info_smc_complete"] = enc(N.UL_DCCH_Message, {"message": ("c1", ("ulInformationTransfer", {
        "criticalExtensions": ("ulInformationTransfer", {"dedicatedNAS-Message": bytes.fromhex(NAS["smc_complete_5gs"])})}))})
    s["dl_info_reg_reject"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("dlInformationTransfer", {"rrc-TransactionIdentifier": 1,
        "criticalExtensions": ("dlInformationTransfer", {"dedicatedNAS-Message": bytes.fromhex(NAS["reg_reject_62"])})}))})
    s["dl_info_reg_accept"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("dlInformationTransfer", {"rrc-TransactionIdentifier": 1,
        "criticalExtensions": ("dlInformationTransfer", {"dedicatedNAS-Message": bytes.fromhex(NAS["reg_accept"])})}))})
    s["ul_info_reg_complete"] = enc(N.UL_DCCH_Message, {"message": ("c1", ("ulInformationTransfer", {
        "criticalExtensions": ("ulInformationTransfer", {"dedicatedNAS-Message": bytes.fromhex(NAS["reg_complete"])})}))})
    s["ul_info_pdu_req"] = enc(N.UL_DCCH_Message, {"message": ("c1", ("ulInformationTransfer", {
        "criticalExtensions": ("ulInformationTransfer", {"dedicatedNAS-Message": bytes.fromhex(NAS["ul_nas_pdu_req"])})}))})
    s["dl_info_pdu_reject"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("dlInformationTransfer", {"rrc-TransactionIdentifier": 2,
        "criticalExtensions": ("dlInformationTransfer", {"dedicatedNAS-Message": bytes.fromhex(NAS["dl_nas_pdu_reject_27"])})}))})
    s["cap_enquiry"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("ueCapabilityEnquiry", {"rrc-TransactionIdentifier": 2,
        "criticalExtensions": ("ueCapabilityEnquiry", {"ue-CapabilityRAT-RequestList": [{"rat-Type": "nr"}, {"rat-Type": "eutra-nr"}]})}))})
    s["meas_report"] = enc(N.UL_DCCH_Message, {"message": ("c1", ("measurementReport", {"criticalExtensions": (
        "measurementReport", {"measResults": {"measId": 3, "measResultServingMOList": [{"servCellId": 0, "measResultServingCell": {
            "physCellId": 412, "measResult": {"cellResults": {"resultsSSB-Cell": {"rsrp": 41, "rsrq": 60, "sinr": 40}}}}}],
            "measResultNeighCells": ("measResultListNR", [
                {"physCellId": 418, "measResult": {"cellResults": {"resultsSSB-Cell": {"rsrp": 52, "rsrq": 68, "sinr": 55}}}},
                {"physCellId": 97, "measResult": {"cellResults": {"resultsSSB-Cell": {"rsrp": 38}}}}])}})}))})
    s["reconfig_ho"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("rrcReconfiguration", {"rrc-TransactionIdentifier": 3,
        "criticalExtensions": ("rrcReconfiguration", {"nonCriticalExtension": {"masterCellGroup": ("CellGroupConfig", {
            "cellGroupId": 0, "spCellConfig": {"reconfigurationWithSync": {
                "spCellConfigCommon": {"physCellId": 418, "downlinkConfigCommon": {"frequencyInfoDL": {
                    "absoluteFrequencySSB": 632544, "frequencyBandList": [78], "absoluteFrequencyPointA": 631008,
                    "scs-SpecificCarrierList": [{"offsetToCarrier": 0, "subcarrierSpacing": "kHz30", "carrierBandwidth": 273}]}},
                    "ss-PBCH-BlockPower": 15, "dmrs-TypeA-Position": "pos2"},
                "newUE-Identity": 21503, "t304": "ms1000"}}})}})}))})
    s["reconfig_complete"] = enc(N.UL_DCCH_Message, {"message": ("c1", ("rrcReconfigurationComplete", {
        "rrc-TransactionIdentifier": 3, "criticalExtensions": ("rrcReconfigurationComplete", {})}))})
    s["reest_req"] = enc(N.UL_CCCH_Message, {"message": ("c1", ("rrcReestablishmentRequest", {"rrcReestablishmentRequest": {
        "ue-Identity": {"c-RNTI": 21503, "physCellId": 418, "shortMAC-I": (0x3C1D, 16)},
        "reestablishmentCause": "otherFailure", "spare": (0, 1)}}))})
    s["release_eps_fb"] = enc(N.DL_DCCH_Message, {"message": ("c1", ("rrcRelease", {"rrc-TransactionIdentifier": 0,
        "criticalExtensions": ("rrcRelease", {"redirectedCarrierInfo": ("eutra", {"eutraFrequency": 1300})})}))})
    s["ue_assist_overheat"] = enc(N.UL_DCCH_Message, {"message": ("c1", ("ueAssistanceInformation", {"criticalExtensions": (
        "ueAssistanceInformation", {"delayBudgetReport": ("type1", "msMinus40"),
                                    "nonCriticalExtension": {"overheatingAssistance": {
                                        "reducedMaxCCs": {"reducedCCsDL-r16": 2, "reducedCCsUL-r16": 1}}}})}))})
    return s


def verify(label, hexstr, pid):
    data = bytes.fromhex(hexstr)
    res = engine.decode_as(pid, data)
    if not res.get("ok"):
        raise SystemExit(f"[FAIL] {label} as {pid}: {res.get('error')}")
    for w in res.get("warnings", []):
        if "Re-encoding" in w:
            raise SystemExit(f"[FAIL] {label}: {w}")
    return res


def main():
    global NR_SCG_BYTES
    NR_SCG_BYTES = nr_scg_reconfig()
    for k, h in NAS.items():
        pid = "nas.5gs" if h.startswith("7E") or h.startswith("2E") else "nas.eps"
        verify(f"NAS {k}", h, pid)
    lte = lte_samples()
    nr = nr_samples()
    for k, h in lte.items():
        pid = {"mib": "lte-rrc.bcch-bch", "sib1": "lte-rrc.bcch-dl-sch", "sib2_barring": "lte-rrc.bcch-dl-sch",
               "paging": "lte-rrc.pcch"}.get(k)
        if pid is None:
            pid = "lte-rrc." + ("ul-ccch" if k.startswith(("rrc_conn_req", "reest_req")) else
                                "dl-ccch" if k in ("rrc_conn_setup", "rrc_conn_reject", "reest_reject") else
                                "ul-dcch" if k.startswith(("rrc_conn_setup_complete", "smc_complete", "cap_info", "reconfig_complete",
                                                            "meas_report", "ul_info", "scg_failure")) else "dl-dcch")
        verify(f"LTE {k}", h, pid)
    for k, h in nr.items():
        pid = {"mib": "nr-rrc.bcch-bch", "sib1": "nr-rrc.bcch-dl-sch"}.get(k)
        if pid is None:
            pid = "nr-rrc." + ("ul-ccch" if k in ("setup_req", "reest_req") else
                               "dl-ccch" if k in ("setup", "reject") else
                               "ul-dcch" if k.startswith(("setup_complete", "ul_info", "meas_report", "reconfig_complete", "ue_assist")) else "dl-dcch")
        verify(f"NR {k}", h, pid)
    out = build_library(lte, nr)
    path = os.path.join(os.path.dirname(HERE), "samples.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(f"wrote {path}: {len(out['single'])} single samples, {len(out['sessions'])} sessions")


def build_library(lte, nr):
    single = [
        {"id": "lte-mr-weak", "title": "LTE Measurement Report, weak serving cell", "group": "LTE RRC",
         "protocol": "lte-rrc.ul-dcch", "hex": spaced(lte["meas_report_weak"])},
        {"id": "lte-reest-hof", "title": "LTE Re-establishment Request after handover failure", "group": "LTE RRC",
         "protocol": "lte-rrc.ul-ccch", "hex": spaced(lte["reest_req_hof"])},
        {"id": "lte-reject", "title": "LTE RRC Connection Reject (wait 10 s)", "group": "LTE RRC",
         "protocol": "lte-rrc.dl-ccch", "hex": spaced(lte["rrc_conn_reject"])},
        {"id": "lte-ho", "title": "LTE Handover command (Reconfiguration with mobilityControlInfo)", "group": "LTE RRC",
         "protocol": "lte-rrc.dl-dcch", "hex": spaced(lte["reconfig_ho"])},
        {"id": "lte-sib1", "title": "LTE SIB1 (Jio, band 3)", "group": "LTE RRC", "protocol": "lte-rrc.bcch-dl-sch",
         "hex": spaced(lte["sib1"])},
        {"id": "lte-mib", "title": "LTE MIB (20 MHz)", "group": "LTE RRC", "protocol": "lte-rrc.bcch-bch", "hex": spaced(lte["mib"])},
        {"id": "lte-setup-complete", "title": "LTE RRC Setup Complete carrying Attach Request", "group": "LTE RRC",
         "protocol": "lte-rrc.ul-dcch", "hex": spaced(lte["rrc_conn_setup_complete"])},
        {"id": "lte-endc", "title": "LTE Reconfiguration adding an NR SCG (EN-DC)", "group": "LTE RRC",
         "protocol": "lte-rrc.dl-dcch", "hex": spaced(lte["reconfig_endc"])},
        {"id": "lte-scg-fail", "title": "EN-DC SCG Failure (random access problem)", "group": "LTE RRC",
         "protocol": "lte-rrc.ul-dcch", "hex": spaced(lte["scg_failure_nr"])},
        {"id": "lte-cap", "title": "LTE UE Capability Information", "group": "LTE RRC", "protocol": "lte-rrc.ul-dcch",
         "hex": spaced(lte["cap_info"])},
        {"id": "nr-setup-req", "title": "NR RRC Setup Request", "group": "NR RRC", "protocol": "nr-rrc.ul-ccch",
         "hex": spaced(nr["setup_req"])},
        {"id": "nr-mr", "title": "NR Measurement Report (SSB RSRP / RSRQ / SINR)", "group": "NR RRC",
         "protocol": "nr-rrc.ul-dcch", "hex": spaced(nr["meas_report"])},
        {"id": "nr-release-epsfb", "title": "NR RRC Release redirecting to LTE", "group": "NR RRC",
         "protocol": "nr-rrc.dl-dcch", "hex": spaced(nr["release_eps_fb"])},
        {"id": "nr-sib1", "title": "NR SIB1", "group": "NR RRC", "protocol": "nr-rrc.bcch-dl-sch", "hex": spaced(nr["sib1"])},
        {"id": "nr-overheat", "title": "NR UE Assistance Information (overheating)", "group": "NR RRC",
         "protocol": "nr-rrc.ul-dcch", "hex": spaced(nr["ue_assist_overheat"])},
        {"id": "eps-attach-req", "title": "EPS Attach Request (IMSI, combined)", "group": "EPS NAS", "protocol": "nas.eps",
         "hex": spaced(NAS["attach_request"])},
        {"id": "eps-attach-accept", "title": "EPS Attach Accept with default bearer", "group": "EPS NAS", "protocol": "nas.eps",
         "hex": spaced(NAS["attach_accept"])},
        {"id": "eps-attach-reject", "title": "EPS Attach Reject #19 with ESM #27 (missing APN)", "group": "EPS NAS",
         "protocol": "nas.eps", "hex": spaced(NAS["attach_reject_19"])},
        {"id": "eps-auth-fail", "title": "EPS Authentication Failure #21 (synch failure)", "group": "EPS NAS",
         "protocol": "nas.eps", "hex": spaced(NAS["auth_failure_21"])},
        {"id": "eps-dedicated", "title": "Activate dedicated bearer QCI 1 (VoLTE)", "group": "EPS NAS",
         "protocol": "nas.eps", "hex": spaced(NAS["act_dedi_qci1"])},
        {"id": "eps-smc", "title": "NAS Security Mode Command (integrity protected)", "group": "EPS NAS",
         "protocol": "nas.eps", "hex": spaced(NAS["smc_eps"])},
        {"id": "5gs-reg-req", "title": "5GS Registration Request (SUCI)", "group": "5GS NAS", "protocol": "nas.5gs",
         "hex": spaced(NAS["reg_request"])},
        {"id": "5gs-reg-accept", "title": "5GS Registration Accept", "group": "5GS NAS", "protocol": "nas.5gs",
         "hex": spaced(NAS["reg_accept"])},
        {"id": "5gs-reg-reject", "title": "5GS Registration Reject #62 (no slices)", "group": "5GS NAS", "protocol": "nas.5gs",
         "hex": spaced(NAS["reg_reject_62"])},
        {"id": "5gs-pdu-accept", "title": "DL NAS Transport with PDU Session Establishment Accept", "group": "5GS NAS",
         "protocol": "nas.5gs", "hex": spaced(NAS["dl_nas_pdu_accept"])},
        {"id": "5gs-pdu-reject", "title": "PDU Session Establishment Reject #27 (unknown DNN)", "group": "5GS NAS",
         "protocol": "nas.5gs", "hex": spaced(NAS["dl_nas_pdu_reject_27"])},
    ]
    sessions = [
        {"id": "lte-attach-ok", "title": "LTE attach, healthy", "description": "Full attach with authentication, security and default bearer.",
         "text": _session([
             ("10:21:33.104", "LTE RRC UL_CCCH RRCConnectionRequest", lte["rrc_conn_req_attach"]),
             ("10:21:33.131", "LTE RRC DL_CCCH RRCConnectionSetup", lte["rrc_conn_setup"]),
             ("10:21:33.152", "LTE RRC UL_DCCH RRCConnectionSetupComplete", lte["rrc_conn_setup_complete"]),
             ("10:21:33.208", "LTE RRC DL_DCCH DLInformationTransfer", lte["dl_info_transfer_auth"]),
             ("10:21:33.251", "LTE RRC UL_DCCH ULInformationTransfer", lte["ul_info_transfer_auth_resp"]),
             ("10:21:33.297", "LTE RRC DL_DCCH DLInformationTransfer", lte["dl_info_transfer_smc"]),
             ("10:21:33.315", "LTE RRC UL_DCCH ULInformationTransfer", lte["ul_info_transfer_smc_complete"]),
             ("10:21:33.402", "LTE RRC DL_DCCH SecurityModeCommand", lte["smc"]),
             ("10:21:33.418", "LTE RRC UL_DCCH SecurityModeComplete", lte["smc_complete"]),
             ("10:21:33.433", "LTE RRC DL_DCCH UECapabilityEnquiry", lte["cap_enquiry"]),
             ("10:21:33.461", "LTE RRC UL_DCCH UECapabilityInformation", lte["cap_info"]),
             ("10:21:33.512", "LTE RRC DL_DCCH RRCConnectionReconfiguration", lte["reconfig_meas_drb"]),
             ("10:21:33.540", "LTE RRC UL_DCCH RRCConnectionReconfigurationComplete", lte["reconfig_complete"]),
             ("10:21:33.566", "LTE RRC UL_DCCH ULInformationTransfer", lte["ul_info_transfer_attach_complete"]),
             ("10:21:35.902", "LTE RRC UL_DCCH MeasurementReport", lte["meas_report_good"]),
         ])},
        {"id": "lte-ho-drop", "title": "LTE handover failure and call drop",
         "description": "Signal fades, handover to PCI 101 fails, re-establishment is rejected.",
         "text": _session([
             ("14:02:10.220", "LTE RRC UL_DCCH MeasurementReport", lte["meas_report_good"]),
             ("14:02:14.871", "LTE RRC UL_DCCH MeasurementReport", lte["meas_report_interf"]),
             ("14:02:17.390", "LTE RRC UL_DCCH MeasurementReport", lte["meas_report_weak"]),
             ("14:02:17.442", "LTE RRC DL_DCCH RRCConnectionReconfiguration", lte["reconfig_ho"]),
             ("14:02:18.463", "LTE RRC UL_CCCH RRCConnectionReestablishmentRequest", lte["reest_req_hof"]),
             ("14:02:18.489", "LTE RRC DL_CCCH RRCConnectionReestablishmentReject", lte["reest_reject"]),
             ("14:02:18.902", "LTE RRC UL_CCCH RRCConnectionRequest", lte["rrc_conn_req"]),
             ("14:02:18.930", "LTE RRC DL_CCCH RRCConnectionReject", lte["rrc_conn_reject"]),
         ])},
        {"id": "nr-sa-slice-reject", "title": "5G SA registration rejected (no slices)",
         "description": "NR RRC setup succeeds, NAS security runs, AMF rejects registration with cause #62.",
         "text": _session([
             ("09:14:02.011", "NR5G RRC BCCH_BCH MIB", nr["mib"]),
             ("09:14:02.040", "NR5G RRC BCCH_DL_SCH SIB1", nr["sib1"]),
             ("09:14:02.315", "NR5G RRC UL_CCCH RRCSetupRequest", nr["setup_req"]),
             ("09:14:02.338", "NR5G RRC DL_CCCH RRCSetup", nr["setup"]),
             ("09:14:02.361", "NR5G RRC UL_DCCH RRCSetupComplete", nr["setup_complete"]),
             ("09:14:02.420", "NR5G RRC DL_DCCH DLInformationTransfer", nr["dl_info_smc"]),
             ("09:14:02.437", "NR5G RRC UL_DCCH ULInformationTransfer", nr["ul_info_smc_complete"]),
             ("09:14:02.510", "NR5G RRC DL_DCCH DLInformationTransfer", nr["dl_info_reg_reject"]),
             ("09:14:02.533", "NR5G RRC DL_DCCH RRCRelease", nr["release_eps_fb"]),
         ])},
        {"id": "nr-sa-pdu-fail", "title": "5G SA PDU session rejected (unknown DNN)",
         "description": "Registration works, PDU session establishment fails with 5GSM cause #27.",
         "text": _session([
             ("16:40:11.002", "NR5G RRC UL_CCCH RRCSetupRequest", nr["setup_req"]),
             ("16:40:11.025", "NR5G RRC DL_CCCH RRCSetup", nr["setup"]),
             ("16:40:11.049", "NR5G RRC UL_DCCH RRCSetupComplete", nr["setup_complete"]),
             ("16:40:11.120", "NR5G RRC DL_DCCH DLInformationTransfer", nr["dl_info_smc"]),
             ("16:40:11.139", "NR5G RRC UL_DCCH ULInformationTransfer", nr["ul_info_smc_complete"]),
             ("16:40:11.188", "NR5G RRC DL_DCCH SecurityModeCommand", nr["smc"]),
             ("16:40:11.240", "NR5G RRC DL_DCCH DLInformationTransfer", nr["dl_info_reg_accept"]),
             ("16:40:11.262", "NR5G RRC UL_DCCH ULInformationTransfer", nr["ul_info_reg_complete"]),
             ("16:40:11.301", "NR5G RRC UL_DCCH ULInformationTransfer", nr["ul_info_pdu_req"]),
             ("16:40:11.355", "NR5G RRC DL_DCCH DLInformationTransfer", nr["dl_info_pdu_reject"]),
             ("16:40:12.870", "NR5G RRC UL_DCCH MeasurementReport", nr["meas_report"]),
         ])},
        {"id": "endc-scg-fail", "title": "EN-DC: NR leg added, then SCG failure",
         "description": "LTE anchor adds an n78 SCG, UE fails random access on the PSCell.",
         "text": _session([
             ("11:05:44.610", "LTE RRC UL_DCCH MeasurementReport", lte["meas_report_good"]),
             ("11:05:44.655", "LTE RRC DL_DCCH RRCConnectionReconfiguration", lte["reconfig_endc"]),
             ("11:05:44.690", "LTE RRC UL_DCCH RRCConnectionReconfigurationComplete", lte["reconfig_complete"]),
             ("11:05:45.712", "LTE RRC UL_DCCH SCGFailureInformationNR", lte["scg_failure_nr"]),
         ])},
    ]
    return {"single": single, "sessions": sessions}


def _session(rows):
    lines = []
    for ts, label, hx in rows:
        lines.append(f"{ts}  {label}")
        lines.append(spaced(hx))
    return "\n".join(lines)


if __name__ == "__main__":
    main()
