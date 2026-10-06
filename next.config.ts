import type { NextConfig } from "next";

// Static export for GitHub Pages. A project site lives under /<repo>, so the
// deploy workflow sets NEXT_PUBLIC_BASE_PATH (empty for local dev and user sites).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
