import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const CODE = "[2-9a-hjkmnp-z]{4}-?[2-9a-hjkmnp-z]{4}";

// Production is a static export served by the Rust server. `next dev` proxies the API to it
// instead, since rewrites are unavailable in export mode.
export default function config(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return { output: "export" };
  const api = process.env.FLUX_API ?? "http://localhost:8080";
  return {
    async rewrites() {
      return [
        { source: "/api/:path*", destination: `${api}/api/:path*` },
        { source: `/:code(${CODE})`, destination: "/" },
      ];
    },
  };
}
