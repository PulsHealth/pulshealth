import Link from "next/link"
import Image from "next/image"

const GITHUB = "https://github.com/PulsHealth/pulshealth"

type FooterLink = { title: string; href: string; external?: boolean }

const footerLinks: Record<string, FooterLink[]> = {
  project: [
    { title: "iOS App", href: "/app" },
    { title: "Self-Hosted Server", href: "/sync" },
    { title: "Source on GitHub", href: GITHUB, external: true },
    { title: "Sync Protocol", href: `${GITHUB}/tree/main/docs/protocol`, external: true },
    { title: "Use It With AI", href: `${GITHUB}/blob/main/docs/ai.md`, external: true },
  ],
  resources: [
    { title: "Knowledge Base", href: "/knowledge-base" },
    { title: "Blog", href: "/blog" },
    { title: "Support", href: "/support" },
    { title: "Report an Issue", href: `${GITHUB}/issues`, external: true },
  ],
  company: [
    { title: "About", href: "/about" },
    { title: "Consulting", href: "/consulting" },
  ],
  legal: [
    { title: "Privacy Policy", href: "/privacy" },
    { title: "Terms of Service", href: "/terms" },
    { title: "License (Apache-2.0)", href: `${GITHUB}/blob/main/LICENSE`, external: true },
  ],
}

const columns: { heading: string; links: FooterLink[] }[] = [
  { heading: "Project", links: footerLinks.project },
  { heading: "Resources", links: footerLinks.resources },
  { heading: "Company", links: footerLinks.company },
  { heading: "Legal", links: footerLinks.legal },
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
          {/* Brand Column */}
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center space-x-1.5">
              <Image src="/logo.svg" alt="" width={28} height={28} />
              <span className="font-semibold">PulsHealth</span>
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">
              Sync Apple Health to a backend you run yourself. Open source, Apache-2.0.
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

        {/* Bottom */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t pt-8 md:flex-row">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} PulsHealth.
          </p>
          <p className="text-sm text-muted-foreground">
            Released under the{" "}
            <a
              href={`${GITHUB}/blob/main/LICENSE`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors underline underline-offset-4"
            >
              Apache License 2.0
            </a>
            {" "}&middot;{" "}
            <a
              href={GITHUB}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors underline underline-offset-4"
            >
              github.com/PulsHealth/pulshealth
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
