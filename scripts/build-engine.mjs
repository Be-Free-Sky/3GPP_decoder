// Build the in-browser decoder bundles (build/engine/*.zip + manifest.json), which
// scripts/payload.mjs embeds into the single index.html.
//
// The Python engine (decoder/engine) and the parts of pycrate it needs are
// compiled to bytecode *inside Pyodide* so the .pyc files match the exact
// Python version the browser runs, then zipped into three bundles:
//   core   pycrate runtime + NAS + LTE/NR RRC + engine (loaded at start)
//   ap     S1AP / NGAP / X2AP / XnAP / F1AP (loaded when first needed)
//   extra  WCDMA RRC + LPP (loaded when first needed)
//
// Usage: node scripts/build-engine.mjs [--if-missing]
// Needs pycrate installed in .venv (pip install -r decoder/requirements.txt)
// or PYCRATE_SITE pointing at a site-packages directory that contains it.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide, version as pyodideVersion } from "pyodide";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "build", "engine");
const MANIFEST = join(OUT, "manifest.json");

function findSitePackages() {
  if (process.env.PYCRATE_SITE) return resolve(process.env.PYCRATE_SITE);
  const win = join(ROOT, ".venv", "Lib", "site-packages");
  if (existsSync(join(win, "pycrate_core"))) return win;
  const lib = join(ROOT, ".venv", "lib");
  if (existsSync(lib)) {
    for (const d of readdirSync(lib)) {
      const p = join(lib, d, "site-packages");
      if (existsSync(join(p, "pycrate_core"))) return p;
    }
  }
  throw new Error("pycrate not found. Run: python -m venv .venv && .venv pip install -r decoder/requirements.txt (or set PYCRATE_SITE)");
}

function newestMtime(dir) {
  let m = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) m = Math.max(m, newestMtime(p));
    else if (e.name.endsWith(".py") || e.name.endsWith(".json")) m = Math.max(m, statSync(p).mtimeMs);
  }
  return m;
}

const DATA_FILES = [join(ROOT, "src", "data", "catalog.json"), join(ROOT, "src", "data", "samples.json")];
if (process.argv.includes("--if-missing") && existsSync(MANIFEST) && DATA_FILES.every((f) => existsSync(f))) {
  const built = statSync(MANIFEST).mtimeMs;
  if (newestMtime(join(ROOT, "decoder", "engine")) < built) {
    console.log("engine bundles are up to date");
    process.exit(0);
  }
}

const site = findSitePackages();
console.log(`pycrate from ${site}`);
const t0 = Date.now();
const py = await loadPyodide();
py.FS.mkdirTree("/site");
py.FS.mkdirTree("/dec");
py.FS.mount(py.FS.filesystems.NODEFS, { root: site }, "/site");
py.FS.mount(py.FS.filesystems.NODEFS, { root: join(ROOT, "decoder") }, "/dec");

const result = py.runPython(`
import sys, os, io, json, zipfile, py_compile, contextlib, importlib
sys.dont_write_bytecode = True
sys.path.insert(0, "/site")
sys.path.insert(0, "/dec")

def site_modules():
    out = set()
    for m in list(sys.modules.values()):
        f = getattr(m, "__file__", None) or ""
        if f.startswith("/site/"):
            out.add(f[len("/site/"):])
    return out

with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    import engine
    from engine import catalog
    for m in ("RRCLTE", "RRCNR"):
        catalog.asn1_module(m)
    # exercise the decoders once so lazily imported pycrate modules are included
    lib = json.load(open("/dec/samples.json"))
    for s in lib["sessions"]:
        engine.decode_text(s["text"])
    for s in lib["single"]:
        engine.decode_text(s["hex"])
core = site_modules()

# whole pycrate runtime packages go in core (small, and modules import each other lazily)
for pkg in ("pycrate_core", "pycrate_asn1rt", "pycrate_mobile"):
    for name in os.listdir("/site/" + pkg):
        if name.endswith(".py"):
            core.add(f"{pkg}/{name}")
core.add("pycrate_asn1dir/__init__.py")

def bundle_for(mods):
    before = site_modules()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        for m in mods:
            catalog.asn1_module(m)
    return site_modules() - before

ap = bundle_for(["S1AP", "NGAP", "X2AP", "XnAP", "F1AP"]) - core
extra = bundle_for(["RRC3G", "LPP"]) - core - ap

engine_files = []
for dp, dn, fn in os.walk("/dec/engine"):
    dn[:] = [d for d in dn if d != "__pycache__"]
    for f in fn:
        if f.endswith(".py"):
            engine_files.append(os.path.join(dp, f)[len("/dec/"):])

def build(name, site_files, dec_files=()):
    buf = io.BytesIO()
    raw = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, base in [(f, "/site/") for f in sorted(site_files)] + [(f, "/dec/") for f in sorted(dec_files)]:
            src = base + rel
            cfile = "/tmp/build.pyc"
            py_compile.compile(src, cfile=cfile, dfile=rel, doraise=True, optimize=1)
            data = open(cfile, "rb").read()
            raw += len(data)
            z.writestr(rel[:-3] + ".pyc", data)
    open(f"/tmp/engine-{name}.zip", "wb").write(buf.getvalue())
    return {"files": len(site_files) + len(dec_files), "raw": raw, "zip": len(buf.getvalue())}

stats = {
    "core": build("core", core, engine_files),
    "ap": build("ap", ap),
    "extra": build("extra", extra),
}
json.dumps({"stats": stats, "python": sys.version.split()[0], "catalog": engine.get_catalog(),
            "modules": {"ap": sorted(ap), "extra": sorted(extra)}})
`);

const info = JSON.parse(result);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const bundles = {};
for (const name of ["core", "ap", "extra"]) {
  const data = py.FS.readFile(`/tmp/engine-${name}.zip`);
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 10);
  const file = `engine-${name}.${hash}.zip`;
  writeFileSync(join(OUT, file), data);
  bundles[name] = { file, bytes: data.length, files: info.stats[name].files };
  console.log(`${name.padEnd(5)} ${(data.length / 1048576).toFixed(2)} MB zip, ${info.stats[name].files} modules`);
}
const samples = JSON.parse(readFileSync(join(ROOT, "decoder", "samples.json"), "utf8"));
writeFileSync(
  MANIFEST,
  JSON.stringify(
    { engine: info.catalog.version, python: info.python, pyodide: pyodideVersion, built: new Date().toISOString(), bundles },
    null,
    2,
  ),
);
// The catalog and samples are also needed by the UI before the engine boots.
const dataDir = join(ROOT, "src", "data");
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "catalog.json"), JSON.stringify(info.catalog, null, 2));
writeFileSync(join(dataDir, "samples.json"), JSON.stringify(samples, null, 2));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s (Python ${info.python}, Pyodide ${pyodideVersion})`);
