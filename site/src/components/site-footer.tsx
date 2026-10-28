import Link from "next/link"
import Image from "next/image"
import { GITHUB_URL } from "@/lib/github"
import { APP_STORE_URL } from "@/components/app-store-badge"

type FooterLink = { title: string; href: string; external?: boolean }

const columns: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "PulsHealth",
    links: [
      { title: "Get the app", href: APP_STORE_URL, external: true },
      { title: "App features", href: "/features/" },
      { title: "Pro & pricing", href: "/pricing/" },
      { title: "Dashboard", href: "https://app.pulshealth.com", external: true },
      { title: "Self-hosting", href: "/server/" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { title: "Examples", href: "/examples/" },
      { title: "Documentation", href: "/docs/" },
      { title: "Knowledge base", href: "/knowledge-base/" },
      { title: "Blog", href: "/blog/" },
      { title: "Support & FAQ", href: "/support/" },
      { title: "About", href: "/about/" },
      { title: "Consulting", href: "/consulting/" },
    ],
  },
  {
    heading: "Developers",
    links: [
      { title: "GitHub", href: GITHUB_URL, external: true },
      { title: "Sync protocol", href: "/docs/protocol/" },
      { title: "Use with AI", href: "/docs/ai/" },
      { title: "Changelog", href: "/docs/changelog/" },
      { title: "Roadmap", href: "/docs/roadmap/" },
      { title: "Discussions", href: `${GITHUB_URL}/discussions`, external: true },
    ],
  },
  {
    heading: "More apps",
    links: [
      { title: "Friend Flex", href: "/friend-flex/" },
      { title: "Watch Workout Pro", href: "/watch-workout-pro/" },
    ],
  },
]

const legalLinks: FooterLink[] = [
  { title: "Privacy", href: "/privacy/" },
  { title: "Security", href: "/docs/security/" },
  { title: "Apache-2.0 license", href: `${GITHUB_URL}/blob/main/LICENSE`, external: true },
]

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className =
    "text-sm text-muted-foreground hover:text-foreground transition-colors"

  if (link.external) {
    return (
      <a href={link.href} data-analytics-placement={link.href === APP_STORE_URL ? "footer" : undefined} target="_blank" rel="noopener noreferrer" className={className}>
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
    <footer className="site-footer border-t">
      <div className="container mx-auto max-w-7xl px-4 py-12">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <Link href="/" className="flex items-center space-x-1.5">
              <Image src="/logo.svg" alt="" width={28} height={28} />
              <span className="font-semibold">PulsHealth</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Sync, export, and control your Apple Health data. Your database. Your AI tools. Your choice.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.heading}>
              <h2 className="mb-4 text-sm font-semibold">{column.heading}</h2>
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
        <nav aria-label="Legal" className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t pt-6">
          {legalLinks.map((link) => <FooterLinkItem key={link.title} link={link} />)}
        </nav>
      </div>
    </footer>
  )
}
