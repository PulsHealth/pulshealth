/** Regenerate the selected sharing card with system-supplied Arial fonts. */
import { ImageResponse } from "next/og";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const logo = await readFile(new URL("../public/logo.svg", import.meta.url));
const logoSrc = `data:image/svg+xml;base64,${logo.toString("base64")}`;
// Arial is supplied by macOS, not redistributed in this repository. Other
// systems can point SOCIAL_CARD_FONT_DIR at their licensed Arial installation.
const fontDir = process.env.SOCIAL_CARD_FONT_DIR ?? "/System/Library/Fonts/Supplemental";
const fonts = [
  { name: "Arial", data: await readFile(join(fontDir, "Arial.ttf")), weight: 400 as const, style: "normal" as const },
  { name: "Arial", data: await readFile(join(fontDir, "Arial Bold.ttf")), weight: 700 as const, style: "normal" as const },
];

const card = new ImageResponse(<div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"flex-start",justifyContent:"center",gap:0,background:"#111b28",color:"#f2f6fc",fontFamily:"Arial",padding:"64px 88px"}}>
  <div style={{display:"flex",alignItems:"center",gap:28}}>
   {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse embeds the brand asset in a PNG. */}
   <img src={logoSrc} width={250} height={250} alt=""/>
   <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:18}}>
    <span style={{fontSize:100,fontWeight:700,letterSpacing:-4,lineHeight:1}}>PulsHealth</span>
    <span style={{fontSize:48,fontWeight:400,letterSpacing:-1,lineHeight:1.15,whiteSpace:"nowrap"}}>Export and sync your health data</span>
   </div>
  </div>
 </div>,{width:1200,height:630,fonts});

const bytes = Buffer.from(await card.arrayBuffer());
// Keep existing image URLs useful for previously shared links.
for (const filename of ["og-pulshealth-navy.png", "og-default.png", "og-unlock-control.png"]) {
  await writeFile(new URL(`../public/${filename}`, import.meta.url), bytes);
}
console.log("gen-social-card: wrote the selected navy card and legacy copies");
