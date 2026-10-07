# Skyworth 3GPP Decoder

Turns LTE and 5G NR signalling hex from Logel (or any modem log) into readable messages, a
signalling ladder and a root cause analysis. It's a single file, `index.html`, with no
install, no server and no network access. Open it straight from disk, or publish it on
GitHub Pages. Either way the log is decoded inside the page and never uploaded.

Copyright © 2026 Rahul Kumbhar. All rights reserved. SKYWORTH, 创维 and the SKYWORTH logo
are trademarks of Skyworth Group.

## What it decodes

| Family | Coverage |
| --- | --- |
| LTE RRC (TS 36.331) | UL/DL CCCH, UL/DL DCCH, BCCH-BCH, BCCH-DL-SCH, PCCH, MCCH, UE capability containers |
| NR RRC (TS 38.331) | UL/DL CCCH, UL-CCCH1, UL/DL DCCH, BCCH-BCH, BCCH-DL-SCH, PCCH, CellGroupConfig, RadioBearerConfig, UE-NR / MR-DC capability |
| EPS NAS (TS 24.301) | EMM and ESM, plain and security protected |
| 5GS NAS (TS 24.501) | 5GMM and 5GSM, including payload containers |
| Also | NB-IoT RRC, WCDMA RRC, 2G/3G NAS (TS 24.008), S1AP, NGAP, X2AP, XnAP, F1AP, LPP |

Containers are decoded recursively: NAS inside RRC, the NR SCG inside an LTE
reconfiguration (EN-DC), UE capability containers, the NAS-PDU inside S1AP / NGAP, and 5GSM
inside 5GMM transport.

## Use it

1. Open `index.html` in Chrome, Edge or Firefox (double-click works), or open the published
   GitHub Pages link. The decoder starts in about 3 seconds.
2. On the home page, choose how to bring the log in:
   - **Paste hex**: bare hex, `0x` lists, hexdumps with offsets, or Logel lines such as
     `14:02:17.442  LTE RRC DL_DCCH RRCConnectionReconfiguration` followed by the bytes.
     The box starts empty every time; nothing is saved between visits.
   - **Upload log**: drop or browse a whole Logel armlog folder, its zip, the `.logel` on its
     own, or a text export (.txt, .log, .hex). See "Logel captures" below.
   - **Examples**: five ready-made sessions, each with a different kind of problem, plus
     single messages to try one at a time.
3. Leave **Protocol** on Auto-detect and press **Decode** (Ctrl+Enter). The channel named in
   a log header is used first; without one, every channel is tried and only decodes that
   re-encode to the identical bytes are kept. If a message cannot be identified, go back
   **Home**, choose its protocol and channel, and decode again.

The results open on the **Summary** for a session, or on the **Message** for one message:

- **Summary**: the main problem in one sentence and what to do, a status for radio link,
  connection, registration and security, and data session, what happened in order, every
  finding with likely causes and checks, and procedure results (attach, registration, RRC
  setup, security, handover, PDU session ...) with durations.
- **Signalling flow**: UE / eNB / gNB / MME / AMF ladder; NAS carried inside RRC is dashed.
- **Messages**: the message list beside the selected message: plain-English summary, key
  fields with physical values (dBm, band, frequency, PLMN operator, timers), cause code
  analysis, the full decoded field tree (readable or spec names, searchable), spec notation
  and hex. `j` / `k` step through the messages.
- **Radio**: serving RSRP / RSRQ / SINR from measurement reports.
- **Context**: PLMN, TAC, cell IDs, IMSI / GUTI / TMSI, APN / DNN, IP address and QoS.

**Home** goes back to the home page (and **Back to the results** returns). Two ways to share:

- **Copy report** copies the content of the page you are on (Summary, Signalling flow,
  Messages, Radio, Context or Files), without the page header or footer, with its colours,
  cards and tables, ready to paste into an Outlook email, Teams or a ticket. It is written for
  Outlook: inline styles, table layout, solid colours, and charts as images. On the Messages
  page it copies the message list and the selected message with its full decode. Plain text
  fallback: a Markdown summary.
- **HTML report** downloads the analysis as one `.html` file (about 1.5 MB) that looks and
  works exactly like this page: the same header, tabs, cards, message list, decode trees and
  charts. It is the app itself without the decoder engine, opened on this analysis, so it
  needs no install and makes no network requests. It is a viewer only: no Home, Copy report,
  HTML report, print or JSON buttons, and the **Files** page (the capture's file list) is
  left out of it.

**JSON** saves the raw decode.
The look, colours, header and footer follow Skyworth Log Prism.

## Several logs at once

Drop several `_armlog` folders together, a parent folder that holds them, or several zips,
then **Analyse N logs**. Every folder whose name ends in `_armlog` is one log; each is read
on its own, one after the other. The **All logs** page then says which folders have issues
and shows a card per folder: the main problem and what to do, *All good*, or why it could
not be analysed (for example a folder without a `.logel`). **Open this log** shows that
folder's full Summary, Signalling flow, Messages, Radio and Context; the All logs tab goes
back. Copy report copies the All logs page, and HTML report shares every log in one file.

## Logel captures (UNISOC armlog)

Logel saves a capture as a folder (`<date>_armlog`) of about 40 files. Drop the folder, its
zip or the `.logel` on **Upload log**, then **Analyse log**. The page unzips it itself and
reads only what helps troubleshooting. The **Files** tab lists every file with what was done
with it and why.

| File | Used for |
| --- | --- |
| `<name>.logel` | Analysed: every RRC and NAS message with the channel the modem logged and a ms timestamp, the modem's serving cell RSRP / RSRQ / SINR traces, and its AT answers (+CESQ, +C5GREG, +COPS, +CGCONTRDP) |
| `<name>.cap` | Analysed when it has packets: IP traffic, every DNS lookup and whether it was answered |
| `<name>_lte.csv`, `_nr.csv` ... | Analysed when they hold rows: RSRP / SINR samples |
| `.lst`, `_modem.ini`, `_log_stat.txt`, `_bookmark.xml` | Read for information: modem and Logel versions, lost packets, bug notes |
| `msgview.*`, `traceview.*`, `phyparamchart.*` ... | Not needed: Logel's display cache, rebuilt from the `.logel` |
| `.iq`, `.wvoice`, `_vt_*.bin`, DSP traces, `_bt.cap`, `_wcn.cap`, empty files | Not needed: radio samples, call media, chip traces or other chips |

The `.logel` is a sequence of UNISOC diag packets. Only the protocol stack stream is read
(the PHY stream, often 90 % of the file, needs UNISOC's trace database). Messages appear
twice in such logs, once as the NAS message and once inside the RRC message that carries it;
the analysis counts that as one attempt. Times are the capture PC's clock, as in Logel.

Limits: ciphered NAS cannot be read without keys (Logel normally records NAS after
deciphering, which decodes fine). MAC / RLC / PDCP headers and Logel's own record headers
are not decoded, so copy the message payload bytes.

## Why the file is about 20 MB

The page carries a complete Python 3.14 runtime (Pyodide, WebAssembly) and the 3GPP ASN.1
and NAS definitions it decodes with (pycrate). That is what lets it decode every RRC and
NAS message exactly to the specification, offline. The interface definitions (S1AP, NGAP,
X2AP, XnAP, F1AP) and WCDMA / LPP are only unpacked when a message needs them.

The page's Content-Security-Policy allows no network requests at all: scripts are pinned
by hash, and the decoder only reads data blocks inside the page.

## Publish on GitHub Pages

`index.html` and `.nojekyll` sit at the repository root, so no workflow is needed:

1. Push the repository to GitHub.
2. In **Settings > Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.

## Develop

Requirements: Node 20.9+, Python 3.10+, and Chrome or Edge for the end-to-end test.

```bash
python -m venv .venv
.venv/Scripts/pip install -r decoder/requirements.txt    # Windows
# .venv/bin/pip install -r decoder/requirements.txt      # macOS / Linux
npm install
npm run dev          # live development server
npm run build        # rebuilds ./index.html (the single published file)
npm test             # opens ./index.html from disk in Chrome / Edge and checks the samples
npm run test:engine  # Python unit tests for the decoder engine
npm run check        # TypeScript and ESLint
```

`npm run build` recompiles the decoder bundles when anything in `decoder/engine` changed
(`npm run engine` forces it), then writes `index.html`. Commit `index.html` with the source
change that produced it.

```
decoder/engine/      Python decoder: protocol catalogue, auto-detection, tree walkers,
                     radio maths (EARFCN / NR-ARFCN / RSRP ...), cause-code knowledge base,
                     per-message insights and session analysis (procedures, root cause)
decoder/tests/       unittest suite
decoder/engine/capture.py  modem log captures: logged channels, AT answers, modem radio, IP / DNS
decoder/tools/       build_samples.py: the sample library, spec-encoded and verified;
                     build_logel_fixture.py: a synthetic Logel armlog zip for the e2e test
scripts/build-engine.mjs   compiles the engine + the pycrate subset to bytecode inside Pyodide
scripts/payload.mjs        embeds the runtime and engine in the page, adds the CSP
src/                 React app (Vite, Tailwind, shadcn/ui on Base UI); src/lib/engine/worker.js
                     runs the decoder in a Web Worker
src/lib/capture/     zip reader, .logel reader, pcap / DNS summary, and the file picker rules
tests/e2e.mjs        end-to-end test of the published file
```

## Third-party software inside index.html

- [Pyodide](https://github.com/pyodide/pyodide) 314.0.7, Mozilla Public License 2.0, unmodified.
- [pycrate](https://github.com/pycrate-org/pycrate) 0.8.1, GNU LGPL 2.1, compiled unmodified;
  `decoder/engine/pycrate_patches.py` corrects the T3346 IEI of the EPS Service Reject at run
  time (0x5F, as in TS 24.301).
- React, Base UI, Tailwind CSS, Motion, Phosphor Icons, Sonner and cmdk (MIT); Geist and
  Geist Mono fonts (SIL Open Font License 1.1).
