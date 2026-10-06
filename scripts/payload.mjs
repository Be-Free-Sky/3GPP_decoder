// The decoder data that index.html carries, and the policy that keeps it offline.
//
// payloadTags()  <script type="application/octet-stream" data-asset> blocks holding the
//                Pyodide runtime (gzip + base64) and the engine bundles (zip + base64).
//                Browsers never execute these; the worker decodes them at start.
// sealPage(html) adds a Content-Security-Policy that names every inline script by its
//                SHA-256 and allows no network access at all (connect only to blob:/data:).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PYODIDE = join(ROOT, "node_modules", "pyodide");
const ENGINE = join(ROOT, "build", "engine");

let cached = null;

export function payloadTags() {
  if (cached) return cached;
  const manifestPath = join(ENGINE, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Decoder bundles are missing. Run: npm run engine");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pyVersion = JSON.parse(readFileSync(join(PYODIDE, "package.json"), "utf8")).version;
  if (manifest.pyodide !== pyVersion) {
    throw new Error(`Engine bundles were compiled for Pyodide ${manifest.pyodide} but ${pyVersion} is installed. Run: npm run engine`);
  }
  const blocks = [
    ["pyodide.mjs", readFileSync(join(PYODIDE, "pyodide.mjs")), true],
    ["pyodide.asm.mjs", readFileSync(join(PYODIDE, "pyodide.asm.mjs")), true],
    ["pyodide.asm.wasm", readFileSync(join(PYODIDE, "pyodide.asm.wasm")), true],
    ["pyodide-lock.json", readFileSync(join(PYODIDE, "pyodide-lock.json")), true],
    ["python_stdlib.zip", readFileSync(join(PYODIDE, "python_stdlib.zip")), false],
    ["engine-core", readFileSync(join(ENGINE, manifest.bundles.core.file)), false],
    ["engine-ap", readFileSync(join(ENGINE, manifest.bundles.ap.file)), false],
    ["engine-extra", readFileSync(join(ENGINE, manifest.bundles.extra.file)), false],
  ];
  const tags = blocks.map(([name, bytes, gz]) => {
    const data = (gz ? gzipSync(bytes, { level: 9 }) : bytes).toString("base64");
    return `<script type="application/octet-stream" data-asset="${name}" data-gz="${gz ? 1 : 0}">${data}</script>`;
  });
  const info = { engine: manifest.engine, pyodide: manifest.pyodide, built: manifest.built };
  // JSON in a base64 block like the rest, so the worker reads every block the same way
  tags.push(
    `<script type="application/octet-stream" data-asset="manifest" data-gz="0">${Buffer.from(JSON.stringify(info)).toString("base64")}</script>`,
  );
  cached = `<!-- Decoder data: Python runtime (Pyodide ${pyVersion}) and the 3GPP decoder engine ${manifest.engine}. -->\n${tags.join("\n")}`;
  return cached;
}

export function sealPage(html) {
  const hashes = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1];
    if (/\bsrc=/.test(attrs) || /application\/(octet-stream|json)/.test(attrs)) continue;
    // browsers hash the script text as parsed, and parsing turns CRLF into LF
    const body = m[2].replace(/\r\n?/g, "\n");
    hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  const policy = [
    "default-src 'none'",
    `script-src ${hashes.join(" ")} blob: 'wasm-unsafe-eval'`,
    "worker-src blob:",
    "connect-src blob: data:",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  return html.replace(/<meta charset="utf-8"\s*\/?>/i, (c) => `${c}\n    ${meta}`);
}
