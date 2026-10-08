import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Contributor instructions are maintained in the repository root.
  agentRules: false,
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['next-mdx-remote'],
};

export default nextConfig;
