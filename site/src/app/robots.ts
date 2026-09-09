import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const aiCrawlers = [
  "GPTBot",
  "ChatGPT-User",
  "CCBot",
  "Google-Extended",
  "anthropic-ai",
  "Claude-Web",
  "FacebookBot",
  "Bytespider",
  "Amazonbot",
  "cohere-ai",
  "PerplexityBot",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
      ...aiCrawlers.map((bot) => ({
        userAgent: bot,
        disallow: "/knowledge-base/",
      })),
    ],
    sitemap: "https://pulshealth.com/sitemap.xml",
  };
}
