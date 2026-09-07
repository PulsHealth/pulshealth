import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { UnitsProvider } from "@/components/UnitsProvider";
import { getDataSource } from "@/lib/queries";
import { configuredTimeZone } from "@/lib/config";

export const metadata: Metadata = {
  title: "PulsHealth",
  description: "A sleek window into your self-hosted HealthKit data.",
};

export const viewport: Viewport = {
  themeColor: "#08080a",
};

// Set the theme before paint to avoid a flash.
const themeScript = `(()=>{try{var t=localStorage.getItem('puls-theme')||'dark';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The data pages are force-dynamic, but the static /_not-found route still
  // prerendered this layout at build time — with no DATABASE_URL in the image
  // builder, that baked a "Database unavailable" chip (and the build-time zone)
  // into every unmatched URL. Defer to request time so the sidebar status is
  // always live.
  await connection();
  const source = await getDataSource();
  const timeZone = configuredTimeZone();
  const runtimeScript = `window.__PULS_TIME_ZONE__=${JSON.stringify(timeZone).replace(/</g, "\\u003c")};${themeScript}`;
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: runtimeScript }} />
      </head>
      <body>
        <div className="app-bg" />
        <div className="grain" />
        <UnitsProvider>
          <div className="shell">
            <Sidebar source={source} />
            <main className="content">{children}</main>
          </div>
        </UnitsProvider>
      </body>
    </html>
  );
}
