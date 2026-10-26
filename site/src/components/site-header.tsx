"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { GitHubIcon } from "@/components/brand-icons"
import { SearchTrigger } from "@/components/search-trigger"
import "./navigation.css"

const primary = [
  { title: "Dashboard", href: "https://app.pulshealth.com/" },
  { title: "Knowledge Base", href: "/knowledge-base/" },
  { title: "Docs", href: "/docs/" },
  { title: "Blog", href: "/blog/" },
  { title: "Consulting", href: "/consulting/" },
]
const secondary = [
  { title: "Self-hosting", href: "/server/" },
  { title: "Support & FAQ", href: "/support/" },
  { title: "About", href: "/about/" },
  { title: "Privacy", href: "/privacy/" },
  { title: "GitHub", href: "https://github.com/PulsHealth/pulshealth" },
]

export function SiteHeader() {
  const pathname = usePathname()
  const [menu, setMenu] = React.useState({ pathname, open: false })
  const open = menu.pathname === pathname && menu.open
  const header = React.useRef<HTMLElement>(null)
  const toggle = React.useRef<HTMLButtonElement>(null)
  const active = (href: string) => href.startsWith("/") && (pathname.replace(/\/$/, "") === href.replace(/\/$/, "") || pathname.startsWith(href) || (href === "/docs/" && pathname.startsWith("/server")))

  React.useEffect(() => {
    if (!open) return
    const close = () => setMenu({ pathname, open: false })
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !header.current?.contains(event.target)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); toggle.current?.focus() } }
    const desktop = window.matchMedia("(min-width: 1024px)")
    const resize = () => { if (desktop.matches) close() }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("keydown", escape)
    desktop.addEventListener("change", resize)
    return () => {
      document.removeEventListener("pointerdown", outside)
      document.removeEventListener("keydown", escape)
      desktop.removeEventListener("change", resize)
    }
  }, [open, pathname])

  const menuLinks = <nav className="site-public-menu" aria-label="Website resources">
    <div className="site-menu-heading">PulsHealth</div>
    {primary.map(item => <a key={item.href} href={item.href} aria-current={active(item.href) ? "page" : undefined}>{item.title}</a>)}
    <div className="site-menu-heading">More</div>
    {secondary.map(item => <a key={item.title} href={item.href}>{item.title}</a>)}
  </nav>

  return <header className="site-header" ref={header}>
    <div className="site-header-inner">
      <Link href="/" className="site-brand"><Image src="/logo.svg" alt="" width={28} height={28} priority /><span>PulsHealth</span></Link>
      <nav className="site-primary" aria-label="Primary">
        {primary.map(item => <a key={item.href} href={item.href} className="site-nav-link" aria-current={active(item.href) ? "page" : undefined}>{item.title}</a>)}
      </nav>
      <div className="site-header-actions">
        <SearchTrigger />
        <a href="https://github.com/PulsHealth/pulshealth" className="site-action site-outline site-github" target="_blank" rel="noopener noreferrer" aria-label="PulsHealth on GitHub"><GitHubIcon /><span>GitHub</span></a>
        <button ref={toggle} type="button" className="site-action site-menu-toggle" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="site-mobile-navigation" onClick={() => setMenu({ pathname, open: !open })}><Menu aria-hidden /></button>
      </div>
    </div>
    <div id="site-mobile-navigation" className={`site-public-dropdown${open ? " is-open" : ""}`} onClick={event => { if (event.target instanceof Element && event.target.closest("a")) setMenu({ pathname, open: false }) }}>{menuLinks}</div>
    <noscript><div className="site-nojs">{menuLinks}</div></noscript>
  </header>
}
