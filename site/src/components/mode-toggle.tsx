"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

const order = ["dark", "light"] as const
type Mode = (typeof order)[number]

const labels: Record<Mode, string> = {
  light: "Theme: light. Switch to dark",
  dark: "Theme: dark. Switch to light",
}

/** Blog articles offer light/dark; the rest of the site is always dark. */
export function ModeToggle() {
  const { theme, setTheme, forcedTheme } = useTheme()
  // true after hydration, false in the server render, with no effect-driven state
  const mounted = React.useSyncExternalStore(() => () => {}, () => true, () => false)

  if (forcedTheme) return null

  const mode: Mode = mounted && order.includes(theme as Mode) ? (theme as Mode) : "dark"
  const next = order[(order.indexOf(mode) + 1) % order.length]
  const Icon = mode === "light" ? Sun : Moon

  return (
    <Button variant="outline" size="icon" onClick={() => setTheme(next)} aria-label={labels[mode]} title={labels[mode]}>
      <Icon className="h-[1.2rem] w-[1.2rem]" />
    </Button>
  )
}
