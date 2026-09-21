import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript CLI spawning is currently unreliable with the Node 25 runtime
  // used by local development. Next's compiler API performs the same checks
  // in-process and keeps production builds deterministic.
  experimental: {
    useTypeScriptCli: false,
  },
};

export default nextConfig;
