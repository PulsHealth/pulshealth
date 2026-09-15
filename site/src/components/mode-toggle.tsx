"use client"

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

const order = ["system", "light", "dark"] as const
type Mode = (typeof order)[number]

const labels: Record<Mode, string> = {
  system: "Theme: follow system. Switch to light",
  light: "Theme: light. Switch to dark",
  dark: "Theme: dark. Switch to system",
}

/**
 * Cycles system → light → dark. "System" is a real state here, not a
 * fallback: the site follows the OS by default and the toggle can put it
 * back, rather than only flipping between the two fixed themes.
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const mode: Mode = mounted && order.includes(theme as Mode) ? (theme as Mode) : "system"
  const next = order[(order.indexOf(mode) + 1) % order.length]
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor

  return (
    <Button variant="outline" size="icon" onClick={() => setTheme(next)} aria-label={labels[mode]} title={labels[mode]}>
      <Icon className="h-[1.2rem] w-[1.2rem]" />
    </Button>
  )
}
