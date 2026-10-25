/** Regenerate the tracked sharing card after changing the public value proposition. */
import { ImageResponse } from "next/og";
import { readFile, writeFile } from "node:fs/promises";

const logo = await readFile(new URL("../public/logo.svg", import.meta.url));
const logoSrc = `data:image/svg+xml;base64,${logo.toString("base64")}`;

const card = new ImageResponse(
  <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#dceeff", color: "#152b46", padding: "56px 72px", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      {/* Satori embeds the local brand asset directly; no network image fetch. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders to PNG. */}
      <img src={logoSrc} width={112} height={112} alt="" />
      <span style={{ fontSize: 42, fontWeight: 700 }}>PulsHealth</span>
    </div>
    <div style={{ display: "flex", flexDirection: "column", fontSize: 88, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-4px" }}>
      <span>Unlock and control</span>
      <span>your health data.</span>
    </div>
    <div style={{ display: "flex", fontSize: 28 }}>pulshealth.com</div>
  </div>,
  { width: 1200, height: 630 },
);
await writeFile(new URL("../public/og-unlock-control.png", import.meta.url), Buffer.from(await card.arrayBuffer()));
console.log("gen-social-card: wrote public/og-unlock-control.png");
