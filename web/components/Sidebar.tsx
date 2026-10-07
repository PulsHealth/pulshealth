"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GROUPS, GROUP_LABELS } from "@/lib/catalog";
import { GROUP_COLOR } from "@/lib/colors";
import type { DataSourceInfo, User } from "@/lib/types";
import { GridIcon, GroupIcon, HomeIcon, MenuIcon, SettingsIcon, SignOutIcon, UserIcon, WorkoutIcon } from "./Icons";
import { BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { UserSwitcher } from "./UserSwitcher";

export function Sidebar({
  source,
  users,
  currentUserId,
  account = null,
  signupsOpen = false,
}: {
  source: DataSourceInfo;
  users: User[];
  currentUserId: string;
  /** The signed-in account, in accounts mode; null otherwise. `demo`: the shared, view-only demo account. */
  account?: { email: string; isAdmin: boolean; demo?: boolean } | null;
  /** Whether /signup takes requests (lib/mode.ts signupsOpen), for the demo's "Create your account". */
  signupsOpen?: boolean;
}) {
  const path = usePathname();
  const [menu, setMenu] = useState({ path, open: false });
  const menuOpen = menu.path === path && menu.open;
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !sidebarRef.current?.contains(event.target)) {
        setMenu({ path, open: false });
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenu({ path, open: false });
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen, path]);
  // A choice is only worth offering when there is one — or when the current
  // user (from a stale cookie or a bad ?user= link) is not in the list at
  // all, so the way back to a real user is one click away.
  const showSwitcher = users.length >= 2 || (users.length >= 1 && !users.some((u) => u.id === currentUserId));

  const primary = [
    { href: "/", label: "Today", icon: <HomeIcon className="nav-icon" /> },
    { href: "/workouts", label: "Workouts", icon: <WorkoutIcon className="nav-icon" /> },
    { href: "/data", label: "All Data", icon: <GridIcon className="nav-icon" /> },
  ];

  return (
    <aside className="sidebar" ref={sidebarRef}>
      <noscript>
        <span className="mobile-menu-fallback" hidden />
      </noscript>
      <div className="sidebar-header">
        <Link href="/" className="brand" onClick={() => setMenu({ path, open: false })}>
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span className="brand-name">PulsHealth</span>
        </Link>

        {account?.demo && <span className="mobile-demo" title="Shared, view-only demo with sample data">Demo</span>}
        <button
          ref={toggleRef}
          type="button"
          className="mobile-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="sidebar-navigation"
          onClick={() => setMenu({ path, open: !menuOpen })}
        >
          <MenuIcon size={18} />
          <span>{menuOpen ? "Close" : "Menu"}</span>
        </button>
      </div>

      <div
        id="sidebar-navigation"
        className={`sidebar-navigation${menuOpen ? " is-open" : ""}`}
        onClick={(event) => {
          // Also close when the current page's link is chosen again.
          if (event.target instanceof Element && event.target.closest("a")) setMenu({ path, open: false });
        }}
      >
        {account?.demo && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "0 8px 12px" }}>
            <span className="chip" title="A shared demo account with de-identified sample data. Nothing here can be changed.">
              <span className="dot" style={{ background: "#ff9f0a" }} />
              <span style={{ fontSize: 12 }}>Demo · sample data</span>
            </span>
            {signupsOpen && (
              <a href="/signup" style={{ fontSize: 12.5, color: "var(--fg-soft)", textDecoration: "underline" }}>
                Create your account
              </a>
            )}
          </div>
        )}

        <nav aria-label="Main navigation">
          {primary.map((item) => {
            const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`nav-link${active ? " active" : ""}`}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="nav-section">
          <div className="eyebrow" style={{ padding: "0 2px 8px" }}>
            Categories
          </div>
          {GROUPS.map((g) => {
            const href = g === "workouts" ? "/workouts" : `/category/${g}`;
            const active = path === href;
            return (
              <Link key={g} href={href} aria-current={active ? "page" : undefined} className={`nav-link${active ? " active" : ""}`}>
                <GroupIcon group={g} className="nav-icon" size={17} style={{ color: GROUP_COLOR[g] } as React.CSSProperties} />
                <span>{GROUP_LABELS[g]}</span>
              </Link>
            );
          })}
        </div>

        <div className="sidebar-spacer" />

        <div className="nav-section" style={{ marginTop: 0 }}>
          {showSwitcher && <UserSwitcher users={users} currentUserId={currentUserId} />}
          {account && (
            <Link
              href="/account"
              aria-current={path === "/account" ? "page" : undefined}
              className={`nav-link${path === "/account" ? " active" : ""}`}
              title={account.demo ? "The shared demo account" : `Signed in as ${account.email}`}
            >
              <UserIcon className="nav-icon" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {account.demo ? "Demo account" : account.email}
              </span>
            </Link>
          )}
          {account?.isAdmin && (
            <Link href="/admin" aria-current={path === "/admin" ? "page" : undefined} className={`nav-link${path === "/admin" ? " active" : ""}`}>
              <GridIcon className="nav-icon" />
              <span>Admin</span>
            </Link>
          )}
          <Link href="/settings" className={`nav-link${path === "/settings" ? " active" : ""}`}>
            <SettingsIcon className="nav-icon" />
            <span>Settings</span>
          </Link>
          <ThemeToggle />
          {account && (
            // A form post, not a link: signing out changes state, and works without JavaScript.
            <form method="post" action="/api/auth/logout">
              <button type="submit" className="nav-link" style={{ width: "100%", cursor: "pointer", background: "transparent" }}>
                <SignOutIcon className="nav-icon" />
                <span>Sign out</span>
              </button>
            </form>
          )}
          <div className="chip" style={{ marginTop: 10, width: "100%", justifyContent: "flex-start" }} title={source.detail}>
            <span
              className="dot"
              style={{ background: source.source === "live" ? "#30d158" : source.source === "demo" ? "#ff9f0a" : "#ff453a" }}
            />
            <span style={{ fontSize: 12 }}>
              {source.source === "live" ? "Live data" : source.source === "demo" ? "Demo data" : "Database unavailable"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
