// Run a command with the project's virtualenv Python (falls back to python on PATH).
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [join(root, ".venv", "Scripts", "python.exe"), join(root, ".venv", "bin", "python")];
const python = candidates.find((p) => existsSync(p)) ?? (process.platform === "win32" ? "python" : "python3");
const res = spawnSync(python, process.argv.slice(2), { cwd: root, stdio: "inherit" });
process.exit(res.status ?? 1);
