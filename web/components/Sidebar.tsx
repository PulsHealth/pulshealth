"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GROUPS, GROUP_LABELS } from "@/lib/catalog";
import { GROUP_COLOR } from "@/lib/colors";
import type { DataSourceInfo, User } from "@/lib/types";
import { GridIcon, GroupIcon, HomeIcon, SettingsIcon, SignOutIcon, UserIcon, WorkoutIcon } from "./Icons";
import { UserSwitcher } from "./UserSwitcher";

export function Sidebar({
  source,
  users,
  currentUserId,
  account = null,
  menuOpen,
  sidebarRef,
  closeMenu,
}: {
  source: DataSourceInfo;
  users: User[];
  currentUserId: string;
  /** The signed-in account, in accounts mode; null otherwise. `demo`: the shared, view-only demo account. */
  account?: { email: string; isAdmin: boolean; demo?: boolean } | null;
  /** Whether /signup takes requests (lib/mode.ts signupsOpen), for the demo banner's Create account link. */
  signupsOpen?: boolean;
  menuOpen: boolean;
  sidebarRef: RefObject<HTMLElement | null>;
  closeMenu: () => void;
}) {
  const path = usePathname();
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
        <span className="sidebar-title">Dashboard</span>
      </div>

      <div
        id="sidebar-navigation"
        className={`sidebar-navigation${menuOpen ? " is-open" : ""}`}
        onClick={(event) => {
          // Also close when the current page's link is chosen again.
          if (event.target instanceof Element && event.target.closest("a")) closeMenu();
        }}
      >

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
              style={{ background: account?.demo ? "#ff9f0a" : source.source === "live" ? "#30d158" : source.source === "demo" ? "#ff9f0a" : "#ff453a" }}
            />
            <span style={{ fontSize: 12 }}>
              {account?.demo ? "Demo data" : source.source === "live" ? "Live data" : source.source === "demo" ? "Demo data" : "Database unavailable"}
            </span>
          </div>
        </div>
        <div className="mobile-site-resources nav-section">
          <nav className="site-public-menu" aria-label="Website resources">
            <div className="site-menu-heading">PulsHealth</div>
            <Link href="/" aria-current="location">Dashboard</Link>
            <a href="https://pulshealth.com/knowledge-base/">Knowledge Base</a>
            <a href="https://pulshealth.com/docs/">Docs</a>
            <a href="https://pulshealth.com/blog/">Blog</a>
            <a href="https://pulshealth.com/consulting/">Consulting</a>
            <div className="site-menu-heading">More</div>
            <a href="https://pulshealth.com/server/">Self-hosting</a>
            <a href="https://pulshealth.com/support/">Support &amp; FAQ</a>
            <a href="https://pulshealth.com/about/">About</a>
            <a href="https://pulshealth.com/privacy/">Privacy</a>
            <a href="https://github.com/PulsHealth/pulshealth" target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
        </div>
      </div>
    </aside>
  );
}
