"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { MenuIcon } from "./Icons";

// Match the public site's primary navigation. The viewer is a separately
// deployed app: only Dashboard and account controls use this origin.
const links = [
  { label: "Dashboard", href: "/" },
  { label: "Knowledge Base", href: "https://pulshealth.com/knowledge-base/" },
  { label: "Docs", href: "https://pulshealth.com/docs/" },
  { label: "Consulting", href: "https://pulshealth.com/consulting/" },
];

export function SiteHeader({ accounts = false, demo = false, open, toggleMenu, headerRef, toggleRef }: {
  accounts?: boolean;
  demo?: boolean;
  open: boolean;
  toggleMenu: () => void;
  headerRef: RefObject<HTMLElement | null>;
  toggleRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <header className="site-header" ref={headerRef}>
      <div className="site-header-inner">
        <a href="https://pulshealth.com/" className="site-brand"><BrandMark size={28} /><span>PulsHealth</span></a>
        {demo && <span className="mobile-demo" title="Shared, view-only demo with sample data">Demo</span>}
        <nav className="site-primary" aria-label="Primary">
          {links.map(item => item.href === "/" ? (
            <Link key={item.label} href="/" className="site-nav-link" aria-current="location">{item.label}</Link>
          ) : (
            <a key={item.label} href={item.href} className="site-nav-link">{item.label}</a>
          ))}
        </nav>
        <div className="site-header-actions">
          <a href="https://github.com/PulsHealth/pulshealth" className="site-github" target="_blank" rel="noopener noreferrer">GitHub</a>
          <Link href={accounts ? "/account" : "/settings"} className="site-nav-link site-account">{accounts ? "Account" : "Settings"}</Link>
          <button ref={toggleRef} type="button" className="site-menu-toggle" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="sidebar-navigation" onClick={toggleMenu}><MenuIcon size={22} /></button>
        </div>
      </div>
    </header>
  );
}
