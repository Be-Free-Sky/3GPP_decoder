import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { payloadTags, sealPage } from "./scripts/payload.mjs";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Put the data blocks before the page's own closing body tag: the last one, since the app's
 *  code can contain the same text (the HTML report it writes is a whole page). */
const withPayload = (html: string) => {
  const at = html.lastIndexOf("</body>");
  return `${html.slice(0, at)}${payloadTags()}\n${html.slice(at)}`;
};

/**
 * Produces the single, offline index.html at the repository root:
 *  - in `vite dev`, the decoder data blocks are injected into the served page;
 *  - on build, the inlined page from vite-plugin-singlefile gets the data blocks and a
 *    Content-Security-Policy that blocks every network request, then lands in ./index.html.
 */
function skyworthSingleFile(): Plugin {
  return {
    name: "skyworth-single-file",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        return ctx.server ? withPayload(html) : html;
      },
    },
    closeBundle() {
      const built = readFileSync(root("dist/index.html"), "utf8");
      const page = sealPage(withPayload(built));
      writeFileSync(root("index.html"), page);
      console.log(`index.html written: ${(Buffer.byteLength(page) / 1048576).toFixed(1)} MB, single file, offline`);
    },
  };
}

export default defineConfig({
  root: root("src"),
  plugins: [react(), tailwindcss(), viteSingleFile(), skyworthSingleFile()],
  resolve: { alias: { "@": root("src") } },
  build: { outDir: root("dist"), emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4096 },
});
