import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Contributor instructions are maintained in the repository root.
  agentRules: false,
  output: 'export',
  // Blog MDX lives beside site/ and supplies utility classes to Tailwind.
  turbopack: { root: path.resolve(__dirname, '..') },
  trailingSlash: true,
  // Search landings should paint without a separate stylesheet request chain.
  // Keep this pinned framework option covered by export and browser checks.
  experimental: { inlineCss: true },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['next-mdx-remote'],
};

export default nextConfig;
