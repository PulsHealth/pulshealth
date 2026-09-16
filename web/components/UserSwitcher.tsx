"use client";

// Which user the viewer shows (SRV-11). A plain form posting to /api/user:
// the select submits itself on change, and without JavaScript the button in
// <noscript> does the same job. Rendered by the Sidebar only when there is a
// choice to make.

import { usePathname } from "next/navigation";
import type { User } from "@/lib/types";
import { ChevronRight, UserIcon } from "./Icons";

/** A user's display name: name, else email, else the short form of the id. */
export function userLabel(user: User): string {
  return user.name?.trim() || user.email?.trim() || shortId(user.id);
}

export function shortId(id: string): string {
  return `User ${id.slice(0, 8)}`;
}

export function UserSwitcher({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const path = usePathname();
  const known = users.some((u) => u.id === currentUserId);

  return (
    <form method="post" action="/api/user" className="user-switcher" title="Which user to show">
      <UserIcon className="nav-icon" />
      <input type="hidden" name="next" value={path} />
      <select
        name="user"
        aria-label="User"
        value={known ? currentUserId : ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {!known && <option value="" disabled>{shortId(currentUserId)} (not in database)</option>}
        {users.map((u) => (
          <option key={u.id} value={u.id}>{userLabel(u)}</option>
        ))}
      </select>
      <ChevronRight size={14} style={{ transform: "rotate(90deg)", color: "var(--faint)", flex: "none" }} />
      <noscript>
        <button type="submit" className="chip" style={{ cursor: "pointer" }}>Switch</button>
      </noscript>
    </form>
  );
}
