"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GROUPS, GROUP_LABELS } from "@/lib/catalog";
import { GROUP_COLOR } from "@/lib/colors";
import type { DataSourceInfo } from "@/lib/types";
import { GridIcon, GroupIcon, HomeIcon, SettingsIcon, WorkoutIcon } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";

export function Sidebar({ source }: { source: DataSourceInfo }) {
  const path = usePathname();

  const primary = [
    { href: "/", label: "Today", icon: <HomeIcon className="nav-icon" /> },
    { href: "/workouts", label: "Workouts", icon: <WorkoutIcon className="nav-icon" /> },
    { href: "/data", label: "All Data", icon: <GridIcon className="nav-icon" /> },
  ];

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          <svg width="26" height="26" viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
            <g transform="translate(6 129)">
              <path d="M40.004 381.819C86.4752 376.225 136.051 373.615 185.474 368.206C211.166 365.394 236.828 362.22 251.472 389.171C265.755 415.459 265.1 448.859 264.639 477.978C263.77 532.879 259.305 587.742 260.278 642.67C260.754 669.528 258.022 725.86 300.01 718.194C321.698 714.236 339.41 697.641 353.442 681.436C379.454 651.394 396.473 614.015 411.631 577.456C472.185 431.404 513.294 277.599 577.976 133.131C583.292 121.898 584.866 118.279 590.641 107.263C592.882 102.989 595.211 98.7631 597.549 94.5431C600.296 89.5831 604.962 81.5231 607.973 76.9347C619.693 59.0723 640.007 24.9456 664.419 47.4087C685.984 67.2492 688.825 100.78 689.068 128.397C689.63 192.023 679.483 257.719 672.043 320.882C669.018 346.575 660.288 376 674.308 399.876C692.058 430.105 734.56 433.139 765.245 430.754C835.383 425.31 907.083 399.616 973.199 376.038" stroke="#0092FF" strokeWidth="80" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>
        </span>
        <span className="brand-name">PulsHealth</span>
      </Link>

      <nav>
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

      <div style={{ flex: 1 }} />

      <div className="nav-section" style={{ marginTop: 0 }}>
        <Link href="/settings" className={`nav-link${path === "/settings" ? " active" : ""}`}>
          <SettingsIcon className="nav-icon" />
          <span>Settings</span>
        </Link>
        <ThemeToggle />
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
    </aside>
  );
}
