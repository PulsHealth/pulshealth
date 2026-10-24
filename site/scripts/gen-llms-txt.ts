#!/usr/bin/env bun
/** Publish AI-readable docs from the same sources as the rendered site. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS, docRoutes } from "../src/lib/docs";
import { renderMachineMarkdown } from "../src/lib/llms";

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.dirname(siteDir);
const publicDir = path.join(siteDir, "public");
const docsDir = path.join(publicDir, "docs");
fs.mkdirSync(docsDir, { recursive: true });

// Remove only generated Markdown; public/docs also holds a tracked legacy redirect.
for (const name of fs.readdirSync(docsDir)) {
  if (name.endsWith(".md")) fs.unlinkSync(path.join(docsDir, name));
}
const index = fs.readFileSync(path.join(repoDir, "llms.txt"), "utf8");
fs.writeFileSync(path.join(publicDir, "llms.txt"), renderMachineMarkdown(index, "llms.txt", docRoutes));

const full = ["# PulsHealth documentation\n\nGenerated from the same sources as https://pulshealth.com/docs/. Start with the server setup guide; use the other sections as needed. For the API schema, read https://pulshealth.com/openapi.json.\n"];
const docs = DOCS.filter(doc => doc.format !== "openapi");
for (const doc of docs) {
  const source = fs.readFileSync(path.join(repoDir, doc.repoPath), "utf8");
  const rendered = renderMachineMarkdown(source, doc.repoPath, docRoutes);
  const preface = `Source: https://pulshealth.com/docs/${doc.slug}/\n\n`;
  fs.writeFileSync(path.join(docsDir, `${doc.slug}.md`), preface + rendered);
  full.push(`\n---\n\n${preface}${rendered}`);
}
fs.writeFileSync(path.join(publicDir, "llms-full.txt"), full.join("\n"));
console.log(`gen-llms-txt: wrote llms.txt, llms-full.txt and ${docs.length} Markdown documents`);
