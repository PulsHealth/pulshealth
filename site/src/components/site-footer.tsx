import Link from "next/link"
import Image from "next/image"
import { GITHUB_URL } from "@/lib/github"
import { APP_STORE_URL } from "@/components/app-store-badge"

type FooterLink = { title: string; href: string; external?: boolean }

const columns: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Project",
    links: [
      { title: "Get the App", href: APP_STORE_URL, external: true },
      { title: "PulsHealth Database", href: "https://app.pulshealth.com/signup", external: true },
      { title: "Self-hosting", href: "/server" },
      { title: "PulsHealth Pro", href: "/pro" },
      { title: "App pricing", href: "/pricing" },
      { title: "Documentation", href: "/docs" },
      { title: "Sync Protocol", href: "/docs/protocol" },
      { title: "Use It With AI", href: "/docs/ai" },
      { title: "About", href: "/about" },
      { title: "Watch Workout Pro", href: "/watch-workout-pro/" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { title: "Knowledge Base", href: "/knowledge-base" },
      { title: "Blog", href: "/blog" },
      { title: "Support & FAQ", href: "/support" },
      { title: "Changelog", href: "/docs/changelog" },
      { title: "Roadmap", href: "/docs/roadmap" },
    ],
  },
  {
    heading: "Community",
    links: [
      { title: "Source on GitHub", href: GITHUB_URL, external: true },
      { title: "Issues", href: `${GITHUB_URL}/issues`, external: true },
      { title: "Discussions", href: `${GITHUB_URL}/discussions`, external: true },
      { title: "Releases", href: `${GITHUB_URL}/releases`, external: true },
      { title: "Consulting", href: "/consulting" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { title: "Privacy Policy", href: "/privacy" },
      { title: "License (Apache-2.0)", href: `${GITHUB_URL}/blob/main/LICENSE`, external: true },
      { title: "Security Policy", href: "/docs/security" },
    ],
  },
]

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className =
    "text-sm text-muted-foreground hover:text-foreground transition-colors"

  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
        {link.title}
      </a>
    )
  }

  return (
    <Link href={link.href} className={className}>
      {link.title}
    </Link>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container mx-auto max-w-7xl px-4 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center space-x-1.5">
              <Image src="/logo.svg" alt="" width={28} height={28} />
              <span className="font-semibold">PulsHealth</span>
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">
              Sync, export, and control your Apple Health data. Your database. Your AI tools. Your choice.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.heading}>
              <h4 className="mb-4 text-sm font-semibold">{column.heading}</h4>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.title}>
                    <FooterLinkItem link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

      </div>
    </footer>
  )
}
