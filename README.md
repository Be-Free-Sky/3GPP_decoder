# Skyworth 3GPP Decoder

Paste hex from Logel (or any LTE / 5G log) and get readable messages, a signalling ladder and root cause analysis. The site is fully static: decoding runs in the browser, so logs never leave the engineer's machine.

## What it decodes

| Family | Coverage |
| --- | --- |
| LTE RRC (TS 36.331) | UL/DL CCCH, UL/DL DCCH, BCCH-BCH, BCCH-DL-SCH, PCCH, MCCH, UE capability containers |
| NR RRC (TS 38.331) | UL/DL CCCH, UL-CCCH1, UL/DL DCCH, BCCH-BCH, BCCH-DL-SCH, PCCH, CellGroupConfig, RadioBearerConfig, UE-NR / MR-DC capability |
| EPS NAS (TS 24.301) | EMM and ESM, plain and security protected |
| 5GS NAS (TS 24.501) | 5GMM and 5GSM, including payload containers |
| Also | NB-IoT RRC, WCDMA RRC, 2G/3G NAS (TS 24.008), S1AP, NGAP, X2AP, XnAP, F1AP, LPP |

Containers are decoded recursively: NAS inside RRC, the NR SCG inside an LTE reconfiguration (EN-DC), UE capability containers, the NAS-PDU inside S1AP / NGAP, and 5GSM inside 5GMM transport.

## Using it

1. Paste hex into the input. Accepted shapes: bare hex, `0x` lists, hexdumps with offsets, or Logel lines such as
   `14:02:17.442  LTE RRC DL_DCCH RRCConnectionReconfiguration` followed by the bytes.
2. Leave **Protocol** on Auto-detect. The channel named in the log header is used first; without a header, every channel is tried and only decodes that re-encode to the identical bytes are accepted. If a message is ambiguous, **Decode as** on the message page offers the alternatives.
3. Press **Decode** (Ctrl+Enter).

With several messages you get:

- **Overview**: verdict, root cause with likely causes and what to check, findings, a timeline of what happened, and procedure results (attach, registration, RRC setup, security, handover, PDU session ...) with durations.
- **Signalling flow**: UE / eNB / gNB / MME / AMF ladder; NAS carried inside RRC is drawn dashed.
- **Message**: plain-English summary, key fields with physical values (dBm, band, frequency, PLMN operator, timers), cause code analysis, the full decoded field tree (readable or spec names, searchable), spec notation and hex.
- **Radio**: serving RSRP / RSRQ / SINR from measurement reports.
- **Context**: PLMN, TAC, cell IDs, IMSI / GUTI / TMSI, APN / DNN, IP address and QoS collected across the log.

**Copy report** puts a Markdown RCA summary on the clipboard for tickets; **JSON** downloads the full decode.

Limits: ciphered NAS cannot be read without keys (Logel normally records NAS after deciphering, which decodes fine). MAC / RLC / PDCP headers and Logel's own record headers are not decoded, so copy the message payload bytes.

## Run locally

Requirements: Node 20.9+ and Python 3.10+.

```bash
python -m venv .venv
.venv/Scripts/pip install -r decoder/requirements.txt    # Windows
# .venv/bin/pip install -r decoder/requirements.txt      # macOS / Linux
npm install
npm run dev            # builds the decoder bundles if needed, then starts Next.js
```

`npm run build` produces the static site in `out/` (`out/index.html` plus assets). `npm run preview` serves `out/` on http://127.0.0.1:4173.

Python is only needed to build the site. Visitors need nothing but a browser.

## Publish on GitHub Pages

1. Push the repository to GitHub.
2. In **Settings > Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow by hand). `.github/workflows/deploy-pages.yml` tests the engine, builds the decoder bundles and the static site with the right base path, and publishes it.

The first visit downloads the Python runtime from jsDelivr (Pyodide) and about 4 MB of decoder bundles; later visits load from the browser cache. Interface definitions (S1AP, NGAP, X2AP, XnAP, F1AP, about 3 MB) and WCDMA / LPP (about 1.5 MB) load only when a message needs them.

## How it works

```
decoder/engine/      Python decoder: protocol catalogue, auto-detection, tree walkers,
                     radio maths (EARFCN / NR-ARFCN / RSRP ...), cause-code knowledge base,
                     per-message insights and session analysis (procedures, root cause)
decoder/tests/       unittest suite (npm run test:engine)
decoder/tools/       build_samples.py: the sample library, spec-encoded and verified
decoder/cli.py       decode a file from the terminal with the same engine
scripts/build-engine.mjs   compiles the engine + pycrate subset to bytecode inside Pyodide
                           and writes public/engine/bundles/*.zip
public/engine/worker.js    Web Worker that runs the engine in Pyodide
src/                 Next.js app (static export), Tailwind, shadcn/ui on Base UI
```

ASN.1 decoding and NAS parsing use [pycrate](https://github.com/pycrate-org/pycrate) (Rel-17 ASN.1). The engine adds the readable layer: labels, units, nested containers, findings and RCA.

Engine checks: `npm run test:engine`. After changing anything in `decoder/engine`, the next `npm run dev` or `npm run build` rebuilds the bundles automatically (or run `npm run engine`).
