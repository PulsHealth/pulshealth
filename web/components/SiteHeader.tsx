"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function SiteHeader({ accounts = false }: { accounts?: boolean }) {
  const pathname = usePathname();
  const [menu, setMenu] = useState({ pathname, open: false });
  const open = menu.pathname === pathname && menu.open;
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) {
        setMenu({ pathname, open: false });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu({ pathname, open: false });
        toggle.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open, pathname]);

  return (
    <header className="site-header" ref={header}>
      <div className="site-header-inner">
        <a href="https://pulshealth.com/" className="site-brand"><BrandMark size={28} /><span>PulsHealth</span></a>
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
          <button ref={toggle} type="button" className="site-menu-toggle" aria-label={open ? "Close site menu" : "Open site menu"} aria-expanded={open} aria-controls="site-mobile-nav" onClick={() => setMenu({ pathname, open: !open })}><MenuIcon size={20} /></button>
        </div>
      </div>
      <nav id="site-mobile-nav" aria-label="Site navigation" className={`site-mobile-nav${open ? " is-open" : ""}`} onClick={event => {
        if (event.target instanceof Element && event.target.closest("a")) setMenu({ pathname, open: false });
      }}>
        {links.map(item => item.href === "/" ? (
          <Link key={item.label} href="/" aria-current="location">{item.label}</Link>
        ) : <a key={item.label} href={item.href}>{item.label}</a>)}
        <a href="https://github.com/PulsHealth/pulshealth" target="_blank" rel="noopener noreferrer">GitHub</a>
        <Link href={accounts ? "/account" : "/settings"}>{accounts ? "Account" : "Settings"}</Link>
      </nav>
      <noscript><nav className="site-nav-fallback" aria-label="Site navigation without JavaScript">{links.map(item => <a key={item.label} href={item.href}>{item.label}</a>)}</nav></noscript>
    </header>
  );
}
