/* Skyworth 3GPP Decoder: decode engine worker.
 *
 * Runs the Python decoder (decoder/engine + pycrate) in Pyodide, off the UI thread,
 * entirely from data embedded in index.html: no network request is ever made, so the
 * page works opened straight from disk and on GitHub Pages alike.
 *
 * The worker is a classic worker created from a Blob, because file:// pages cannot start
 * module workers. Every module it imports comes from a Blob it creates itself, which
 * browsers allow even on file://.
 *
 * main -> worker  { type: "boot", assets }   assets: name -> { data: base64, gz: bool }
 *                 { id, type: "decode", text, protocol, split, overrides }
 *                 { id, type: "capture", capture }   (a modem log capture, see decoder/engine/capture.py)
 * worker -> main  { type: "progress", stage, label }
 *                 { type: "ready", catalog, info }   { type: "fatal", error }
 *                 { id, type: "result", data } | { id, type: "error", error }
 */

// Pyodide rejects classic workers by probing importScripts. Nothing here needs it (the
// runtime module is handed over directly), so present as a module worker.
self.importScripts = () => {
  throw new TypeError("importScripts is not available");
};

let py = null;
let assets = null;
let info = null;
const loaded = new Set();
let booting = null;

const post = (msg) => self.postMessage(msg);
const progress = (stage, label) => post({ type: "progress", stage, label });

function fromBase64(s) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(s);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function bytesOf(name) {
  const a = assets[name];
  if (!a) throw new Error(`The page is missing the "${name}" data block. Rebuild it with npm run build.`);
  const raw = fromBase64(a.data);
  a.data = null; // free the base64 copy
  return a.gz ? gunzip(raw) : raw;
}

const textOf = async (name) => new TextDecoder().decode(await bytesOf(name));
const blobUrl = (data, type) => URL.createObjectURL(new Blob([data], { type }));

async function loadBundle(name) {
  if (loaded.has(name)) return;
  const zip = await bytesOf(`engine-${name}`);
  py.unpackArchive(zip.buffer, "zip", { extractDir: "/engine" });
  py.runPython("import importlib; importlib.invalidate_caches()");
  loaded.add(name);
}

async function boot(payload) {
  assets = payload;
  info = assets.manifest ? JSON.parse(new TextDecoder().decode(fromBase64(assets.manifest.data))) : {};
  progress("runtime", "Unpacking Python runtime");
  const wasm = await bytesOf("pyodide.asm.wasm");
  const realFetch = self.fetch.bind(self);
  // The only file Pyodide fetches itself is the wasm binary: serve it from memory.
  self.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("pyodide.asm.wasm")) {
      return Promise.resolve(new Response(wasm, { headers: { "content-type": "application/wasm" } }));
    }
    return realFetch(input, init);
  };
  const { loadPyodide } = await import(blobUrl(await textOf("pyodide.mjs"), "text/javascript"));
  const runtime = await import(blobUrl(await textOf("pyodide.asm.mjs"), "text/javascript"));
  const lockFileContents = JSON.parse(await textOf("pyodide-lock.json"));
  const stdLibURL = blobUrl(await bytesOf("python_stdlib.zip"), "application/zip");
  progress("runtime", "Starting Python");
  py = await loadPyodide({
    indexURL: "https://offline.invalid/pyodide/",
    createPyodideModule: runtime.default,
    lockFileContents,
    stdLibURL,
    stdout: () => {},
    stderr: () => {},
  });
  progress("engine", "Loading the decoder");
  await loadBundle("core");
  progress("init", "Loading 3GPP definitions");
  py.runPython(`
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, "/engine")
import json, engine
from engine import catalog as _catalog
_catalog.asn1_module("RRCLTE")
_catalog.asn1_module("RRCNR")
`);
  const catalog = JSON.parse(py.runPython("json.dumps(engine.get_catalog())"));
  info.python = py.runPython("import sys; sys.version.split()[0]");
  post({ type: "ready", catalog, info });
}

async function decode(msg) {
  if (!py) throw new Error("The decoder engine failed to start. Reload the page to try again.");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let out;
      if (msg.type === "capture") {
        py.globals.set("_CAP", msg.capture);
        out = py.runPython("json.dumps(engine.decode_capture(json.loads(_CAP)), default=str)");
      } else {
        py.globals.set("_TEXT", msg.text);
        py.globals.set("_PROTO", msg.protocol || "auto");
        py.globals.set("_SPLIT", msg.split || "auto");
        py.globals.set("_OVR", JSON.stringify(msg.overrides || {}));
        out = py.runPython("json.dumps(engine.decode_text(_TEXT, _PROTO, _SPLIT, json.loads(_OVR)), default=str)");
      }
      return JSON.parse(out);
    } catch (err) {
      // The large interface definitions ship as separate blocks, unpacked on first use.
      const m = /bundle:(\w+):(\w+)/.exec(String(err && err.message));
      if (m && !loaded.has(m[1])) {
        progress("module", `Unpacking ${m[2]} definitions`);
        await loadBundle(m[1]);
        continue;
      }
      throw err;
    }
  }
  throw new Error("The decoder could not load the required protocol definitions.");
}

function cleanError(err) {
  const lines = String((err && err.message) || err).trim().split("\n");
  return lines[lines.length - 1].slice(0, 400);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "boot") {
    booting = booting || boot(msg.assets).catch((err) => post({ type: "fatal", error: cleanError(err) }));
    return;
  }
  if (msg.type === "decode" || msg.type === "capture") {
    try {
      await booting;
      const data = await decode(msg);
      post({ id: msg.id, type: "result", data });
    } catch (err) {
      post({ id: msg.id, type: "error", error: cleanError(err) });
    }
  }
};
