/** Regenerate the tracked sharing card after changing the public value proposition. */
import { ImageResponse } from "next/og";
import { writeFile } from "node:fs/promises";

const card = new ImageResponse(
  <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#dceeff", color: "#152b46", padding: "62px 72px", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>PulsHealth</div>
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 86, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-4px" }}>Unlock your health data.</div>
      <div style={{ fontSize: 34, marginTop: 28, maxWidth: 900, lineHeight: 1.3 }}>Sync, export, and control your Apple Health data.</div>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24 }}>
      <span>Your database. Your AI tools. Your choice.</span>
      <span>pulshealth.com</span>
    </div>
  </div>,
  { width: 1200, height: 630 },
);
await writeFile(new URL("../public/og-default.png", import.meta.url), Buffer.from(await card.arrayBuffer()));
console.log("gen-social-card: wrote public/og-default.png");
