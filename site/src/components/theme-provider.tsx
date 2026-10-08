"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { usePathname } from "next/navigation"

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isBlogArticle = /^\/blog\/[^/]+\/?$/.test(pathname)

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      forcedTheme={isBlogArticle ? undefined : "dark"}
      storageKey="pulshealth-blog-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
