/* Skyworth 3GPP Decoder: decode engine worker.
 *
 * Runs the Python decoder (decoder/engine + pycrate) in Pyodide, off the UI
 * thread. Loaded as a module worker (Pyodide ships an ES module build). Bundles are precompiled .pyc zips produced by scripts/build-engine.mjs;
 * the large interface modules (S1AP, NGAP, ...) load only when first needed.
 *
 * main -> worker  { id, type: "decode", text, protocol, split }
 * worker -> main  { type: "progress", stage, label, loaded?, total? }
 *                 { type: "ready", catalog, info }
 *                 { id, type: "result", data } | { id, type: "error", error }
 */

const BUNDLES = new URL("./bundles/", self.location.href);
const CACHE = "skyworth-3gpp-engine";

let py = null;
let manifest = null;
const loaded = new Set();
let booting = null;

function post(msg) {
  self.postMessage(msg);
}

function progress(stage, label, loadedBytes, total) {
  post({ type: "progress", stage, label, loaded: loadedBytes, total });
}

async function openCache() {
  try {
    return await caches.open(CACHE);
  } catch {
    return null; // Cache Storage needs a secure context; plain HTTP still works without it
  }
}

async function fetchBundle(name) {
  const meta = manifest.bundles[name];
  const url = new URL(meta.file, BUNDLES).href;
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${meta.file} (HTTP ${res.status})`);
  const total = meta.bytes || Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    progress(name === "core" ? "engine" : "module", name === "core" ? "Downloading decoder" : `Downloading ${name.toUpperCase()} definitions`, got, total);
  }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  if (cache) {
    try {
      // keep only the current build of each bundle
      for (const req of await cache.keys()) {
        if (req.url.includes(`/engine-${name}.`) && req.url !== url) await cache.delete(req);
      }
      await cache.put(url, new Response(buf.slice().buffer, { headers: { "content-type": "application/zip" } }));
    } catch {
      /* quota or private mode: fine, just not cached */
    }
  }
  return buf.buffer;
}

async function loadBundle(name) {
  if (loaded.has(name)) return;
  const buffer = await fetchBundle(name);
  py.unpackArchive(buffer, "zip", { extractDir: "/engine" });
  py.runPython("import importlib; importlib.invalidate_caches()");
  loaded.add(name);
}

async function boot() {
  progress("runtime", "Starting decoder");
  const res = await fetch(new URL("manifest.json", BUNDLES).href, { cache: "no-cache" });
  if (!res.ok) throw new Error("Decoder bundles are missing. Run `npm run engine` to build them.");
  manifest = await res.json();
  const cdn = `https://cdn.jsdelivr.net/pyodide/v${manifest.pyodide}/full/`;
  progress("runtime", "Loading Python runtime");
  const { loadPyodide } = await import(`${cdn}pyodide.mjs`);
  py = await loadPyodide({ indexURL: cdn, stdout: () => {}, stderr: () => {} });
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
  post({ type: "ready", catalog, info: { engine: manifest.engine, python: manifest.python, pyodide: manifest.pyodide, built: manifest.built } });
}

async function decode({ text, protocol, split, overrides }) {
  if (!py) throw new Error("The decoder engine failed to start. Reload the page to try again.");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      py.globals.set("_TEXT", text);
      py.globals.set("_PROTO", protocol || "auto");
      py.globals.set("_SPLIT", split || "auto");
      py.globals.set("_OVR", JSON.stringify(overrides || {}));
      const out = py.runPython("json.dumps(engine.decode_text(_TEXT, _PROTO, _SPLIT, json.loads(_OVR)), default=str)");
      return JSON.parse(out);
    } catch (err) {
      const m = /bundle:(\w+):(\w+)/.exec(String(err && err.message));
      if (m && !loaded.has(m[1])) {
        progress("module", `Loading ${m[2]} definitions`);
        await loadBundle(m[1]);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Decoder could not load the required protocol definitions.");
}

function cleanError(err) {
  const msg = String((err && err.message) || err);
  const lines = msg.trim().split("\n");
  return lines[lines.length - 1].slice(0, 400);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "boot") {
    booting = booting || boot().catch((err) => post({ type: "fatal", error: cleanError(err) }));
    return;
  }
  if (msg.type === "decode") {
    try {
      if (!booting) booting = boot();
      await booting;
      const data = await decode(msg);
      post({ id: msg.id, type: "result", data });
    } catch (err) {
      post({ id: msg.id, type: "error", error: cleanError(err) });
    }
  }
};
