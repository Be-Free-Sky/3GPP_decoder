// Serve the built site (out/) on http://127.0.0.1:4173 and open it in the browser.
// The site cannot run from file:// (absolute asset paths, Web Worker and fetch are blocked there).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
};

if (!existsSync(join(ROOT, "index.html"))) {
  console.error("No build found in out/. Run `npm run build` first.");
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": TYPES[".html"] });
    createReadStream(join(ROOT, "404.html")).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  const link = `http://127.0.0.1:${PORT}/`;
  console.log(`Skyworth 3GPP Decoder running at ${link}  (Ctrl+C to stop)`);
  if (process.argv.includes("--no-open")) return;
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", link]] : process.platform === "darwin" ? ["open", [link]] : ["xdg-open", [link]];
  spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`Port ${PORT} is busy. Open http://127.0.0.1:${PORT}/ or set PORT to another number.`);
  else console.error(e.message);
  process.exit(1);
});
