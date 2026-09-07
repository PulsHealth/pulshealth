import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for the Docker image.
  output: "standalone",
  // pg is a server-only dependency; keep it external to the bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
