import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["index.html", "dist/**", "build/**", "node_modules/**", ".venv/**", "decoder/**", "src/components/ui/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["src/lib/engine/worker.js"],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ["scripts/**/*.{js,mjs}", "vite.config.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // the e2e test also passes functions that run inside the page
    files: ["tests/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
