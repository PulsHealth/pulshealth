import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Search and user-directed retrieval are separate from automated reuse/training.
const searchAgents = ["Googlebot", "Bingbot", "OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"];
const restrictedAgents = ["GPTBot", "CCBot", "Google-Extended", "ClaudeBot", "anthropic-ai", "Claude-Web", "FacebookBot", "Bytespider", "Amazonbot", "cohere-ai", "Applebot-Extended"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: searchAgents, allow: "/" },
      { userAgent: restrictedAgents, disallow: "/knowledge-base/" },
    ],
    sitemap: "https://pulshealth.com/sitemap.xml",
  };
}
