import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Contributor instructions are maintained in the repository root.
  agentRules: false,
  output: 'export',
  // Blog MDX lives beside site/ and supplies utility classes to Tailwind.
  turbopack: { root: path.resolve(__dirname, '..') },
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['next-mdx-remote'],
};

export default nextConfig;
