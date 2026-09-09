"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Menu, Smartphone, BookOpen, Bot, LifeBuoy, MessageCircle, FileText, Server, FileCode2, Github, Bug, Info } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ModeToggle } from "@/components/mode-toggle"
import { SearchTrigger } from "@/components/search-trigger"

const GITHUB = "https://github.com/PulsHealth/pulshealth"

type NavItem = {
  title: string;
  href: string;
  description: string;
  icon: typeof LifeBuoy;
  external?: boolean;
  section?: string;
  disabled?: boolean;
}

const project: NavItem[] = [
  {
    title: "iOS App",
    href: "/app",
    description: "Sync Apple Health to a server you run",
    icon: Smartphone,
  },
  {
    title: "Self-Hosted Server",
    href: "/sync",
    description: "Postgres, Grafana and a web viewer via Docker Compose",
    icon: Server,
  },
  {
    title: "Sync Protocol",
    href: `${GITHUB}/tree/main/docs/protocol`,
    description: "The spec, JSON Schema and fixtures for your own backend",
    icon: FileCode2,
    external: true,
  },
  {
    title: "Use It With AI",
    href: `${GITHUB}/blob/main/docs/ai.md`,
    description: "Read-only MCP server for Claude, Claude Code and Cursor",
    icon: Bot,
    external: true,
  },
  {
    title: "Source on GitHub",
    href: GITHUB,
    description: "App, server, protocol and dashboards — Apache-2.0",
    icon: Github,
    external: true,
  },
]

const resources: NavItem[] = [
  {
    title: "Knowledge Base",
    href: "/knowledge-base",
    description: "Reference for Apple Health metrics",
    icon: BookOpen,
    section: "Support",
  },
  {
    title: "Support",
    href: "/support",
    description: "Help center & contact",
    icon: LifeBuoy,
    section: "Support",
  },
  {
    title: "Report an Issue",
    href: `${GITHUB}/issues`,
    description: "Bugs, questions and feature requests",
    icon: Bug,
    section: "Support",
    external: true,
  },
  {
    title: "About",
    href: "/about",
    description: "The project and its background",
    icon: Info,
    section: "Company",
  },
  {
    title: "Blog",
    href: "/blog",
    description: "Updates & articles",
    icon: FileText,
    section: "Company",
  },
  {
    title: "Contact",
    href: "/support",
    description: "Get in touch",
    icon: MessageCircle,
    section: "Company",
  },
]

export function SiteHeader() {
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto max-w-7xl flex h-14 items-center px-4">
        {/* Logo */}
        <Link href="/" className="mr-6 flex items-center space-x-1.5">
          <Image src="/logo.svg" alt="" width={28} height={28} priority />
          <span className="font-semibold">PulsHealth</span>
        </Link>

        {/* Desktop Navigation */}
        <NavigationMenu className="hidden md:flex">
          <NavigationMenuList>
            {/* Project Dropdown */}
            <NavigationMenuItem>
              <NavigationMenuTrigger>Project</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px]">
                  {project.map((item) => (
                    <ListItem
                      key={item.title}
                      title={item.title}
                      href={item.href}
                      icon={item.icon}
                      external={item.external}
                    >
                      {item.description}
                    </ListItem>
                  ))}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>

            {/* Resources Dropdown */}
            <NavigationMenuItem>
              <NavigationMenuTrigger>Resources</NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Support</p>
                    <ul className="space-y-1">
                      {resources.filter(r => r.section === "Support").map((item) => (
                        <ListItem
                          key={item.title}
                          title={item.title}
                          href={item.href}
                          icon={item.icon}
                          external={item.external}
                          disabled={item.disabled}
                        >
                          {item.description}
                        </ListItem>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">Company</p>
                    <ul className="space-y-1">
                      {resources.filter(r => r.section === "Company").map((item) => (
                        <ListItem
                          key={item.title}
                          title={item.title}
                          href={item.href}
                          icon={item.icon}
                          external={item.external}
                          disabled={item.disabled}
                        >
                          {item.description}
                        </ListItem>
                      ))}
                    </ul>
                  </div>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>

            {/* Consulting Link */}
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link
                  href="/consulting"
                  className={cn(
                    "group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none disabled:pointer-events-none disabled:opacity-50",
                    pathname === "/consulting" && "bg-accent/50"
                  )}
                >
                  Consulting
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          <SearchTrigger />
          <Button asChild variant="ghost" size="icon" className="hidden md:inline-flex">
            <a href={GITHUB} target="_blank" rel="noopener noreferrer">
              <Github className="h-5 w-5" />
              <span className="sr-only">PulsHealth on GitHub</span>
            </a>
          </Button>
          <ModeToggle />

          {/* Mobile Menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-[400px]">
              <SheetHeader>
                <SheetTitle className="text-left">Menu</SheetTitle>
              </SheetHeader>
              <nav className="mt-8 flex flex-col gap-6">
                {/* Project Section */}
                <div>
                  <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider px-3">Project</p>
                  <div className="space-y-1">
                    {project.map((item) => (
                      <MobileNavItem key={item.title} item={item} onNavigate={() => setOpen(false)} />
                    ))}
                  </div>
                </div>

                {/* Resources Section */}
                <div>
                  <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider px-3">Resources</p>
                  <div className="space-y-1">
                    {resources.filter(r => !r.disabled).map((item) => (
                      <MobileNavItem key={item.title} item={item} onNavigate={() => setOpen(false)} />
                    ))}
                  </div>
                </div>

                {/* CTA */}
                <div className="pt-4 mt-auto border-t">
                  <Button asChild className="w-full bg-brand hover:bg-brand-dark text-brand-foreground h-12 text-base">
                    <a href={GITHUB} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                      <Github className="mr-2 h-4 w-4" />
                      View on GitHub
                    </a>
                  </Button>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

function MobileNavItem({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const className =
    "flex items-center gap-4 rounded-lg px-3 py-3 text-sm hover:bg-accent transition-colors"
  const body = (
    <>
      <item.icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{item.title}</div>
        <div className="text-xs text-muted-foreground truncate">{item.description}</div>
      </div>
    </>
  )

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className={className}
      >
        {body}
      </a>
    )
  }

  return (
    <Link href={item.href} onClick={onNavigate} className={className}>
      {body}
    </Link>
  )
}

interface ListItemProps extends React.ComponentPropsWithoutRef<"a"> {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  disabled?: boolean
  external?: boolean
}

const ListItem = React.forwardRef<React.ElementRef<"a">, ListItemProps>(
  ({ className, title, children, icon: Icon, disabled, external, href, ...props }, ref) => {
    if (disabled) {
      return (
        <li>
          <div
            className={cn(
              "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none opacity-50 cursor-not-allowed",
              className
            )}
          >
            <div className="flex items-center gap-2">
              {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
              <div className="text-sm font-medium leading-none">{title}</div>
            </div>
            <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
              {children}
            </p>
          </div>
        </li>
      )
    }

    const itemClassName = cn(
      "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      className
    )

    const body = (
      <>
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          <div className="text-sm font-medium leading-none">{title}</div>
        </div>
        <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
          {children}
        </p>
      </>
    )

    return (
      <li>
        <NavigationMenuLink asChild>
          {external ? (
            <a
              ref={ref}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClassName}
              {...props}
            >
              {body}
            </a>
          ) : (
            <Link
              ref={ref as React.Ref<HTMLAnchorElement>}
              href={href || "#"}
              className={itemClassName}
              {...props}
            >
              {body}
            </Link>
          )}
        </NavigationMenuLink>
      </li>
    )
  }
)
ListItem.displayName = "ListItem"
