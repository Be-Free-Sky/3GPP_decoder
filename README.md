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
2. Paste hex into the input. Accepted shapes: bare hex, `0x` lists, hexdumps with offsets,
   or Logel lines such as `14:02:17.442  LTE RRC DL_DCCH RRCConnectionReconfiguration`
   followed by the bytes. **Samples** loads ready-made sessions.
3. Leave **Protocol** on Auto-detect and press **Decode** (Ctrl+Enter). The channel named in
   a log header is used first; without one, every channel is tried and only decodes that
   re-encode to the identical bytes are kept. **Decode as** on a message offers the others.

With several messages you get:

- **Overview**: verdict, root cause with likely causes and what to check, findings, a
  timeline of what happened, and procedure results (attach, registration, RRC setup,
  security, handover, PDU session ...) with durations.
- **Signalling flow**: UE / eNB / gNB / MME / AMF ladder; NAS carried inside RRC is dashed.
- **Message**: plain-English summary, key fields with physical values (dBm, band, frequency,
  PLMN operator, timers), cause code analysis, the full decoded field tree (readable or
  spec names, searchable), spec notation and hex.
- **Radio**: serving RSRP / RSRQ / SINR from measurement reports.
- **Context**: PLMN, TAC, cell IDs, IMSI / GUTI / TMSI, APN / DNN, IP address and QoS.

**Copy report** puts a Markdown RCA summary on the clipboard for tickets; **JSON** saves
the full decode.

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
decoder/tools/       build_samples.py: the sample library, spec-encoded and verified
decoder/cli.py       decode a file from the terminal with the same engine
scripts/build-engine.mjs   compiles the engine + the pycrate subset to bytecode inside Pyodide
scripts/payload.mjs        embeds the runtime and engine in the page, adds the CSP
src/                 React app (Vite, Tailwind, shadcn/ui on Base UI); src/lib/engine/worker.js
                     runs the decoder in a Web Worker
tests/e2e.mjs        end-to-end test of the published file
```

## Third-party software inside index.html

- [Pyodide](https://github.com/pyodide/pyodide) 314.0.7, Mozilla Public License 2.0, unmodified.
- [pycrate](https://github.com/pycrate-org/pycrate) 0.8.1, GNU LGPL 2.1, compiled unmodified;
  `decoder/engine/pycrate_patches.py` corrects the T3346 IEI of the EPS Service Reject at run
  time (0x5F, as in TS 24.301).
- React, Base UI, Tailwind CSS, Motion, Phosphor Icons, Sonner and cmdk (MIT); Geist and
  Geist Mono fonts (SIL Open Font License 1.1).
