import Link from "next/link";
import { ArrowLeft, Download, Lock, LockOpen } from "lucide-react";

import { RepoMarkdown } from "@/lib/markdown";
import { docHref, docRoutes } from "@/lib/docs";
import { EXAMPLE_BASE_URL, type ApiDocument, type ApiOperation, type ApiResponse } from "@/lib/openapi";
import { cn } from "@/lib/utils";

/**
 * The product API reference: every operation of the OpenAPI document, grouped
 * by tag, each with its parameters, its responses, the fields of its success
 * body, a curl line and an example. Rendered at build time from
 * `server/api/openapi.json`; nothing here runs in the browser.
 */

const SPEC_REPO_PATH = "server/api/openapi.json";
/** Where `scripts/gen-openapi.ts` publishes the document on the site. */
export const SPEC_URL = "/openapi.json";

function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div
      className={cn(
        "docs-prose prose prose-zinc dark:prose-invert max-w-none prose-a:text-brand prose-a:no-underline hover:prose-a:underline prose-p:my-2",
        className,
      )}
    >
      <RepoMarkdown source={source} docRepoPath={SPEC_REPO_PATH} routes={docRoutes} />
    </div>
  );
}

function CodeBlock({ code, lang, title }: { code: string; lang: string; title: string }) {
  return <Markdown source={`\`\`\`${lang} title="${title}"\n${code}\n\`\`\``} className="prose-pre:my-0 [&_figure]:my-0" />;
}

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold tracking-wide text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      {method}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.startsWith("2")
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : status.startsWith("4")
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "bg-red-500/10 text-red-700 dark:text-red-400";
  return <span className={cn("inline-flex rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold", tone)}>{status}</span>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

/** Inline-code spans in a short description, without a full Markdown pass. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Parameters({ operation }: { operation: ApiOperation }) {
  if (operation.parameters.length === 0) return null;
  return (
    <div>
      <SectionLabel>Parameters</SectionLabel>
      <ul className="divide-y rounded-lg border">
        {operation.parameters.map((p) => (
          <li key={`${p.in}-${p.name}`} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="font-mono text-sm font-semibold text-foreground">{p.name}</code>
              <span className="font-mono text-xs text-muted-foreground">{p.type}</span>
              <span className="text-xs text-muted-foreground">{p.in}</span>
              {p.required && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">required</span>}
            </div>
            {p.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                <InlineText text={p.description} />
              </p>
            )}
            {p.constraints.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                <InlineText text={p.constraints.join(" · ")} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fields({ response }: { response: ApiResponse }) {
  if (!response.fields || response.fields.length === 0) return null;
  return (
    <div>
      <SectionLabel>Response fields</SectionLabel>
      <ul className="divide-y rounded-lg border">
        {response.fields.map((field) => {
          const name = field.path.split(".").pop() ?? field.path;
          return (
            <li key={field.path} className="py-2.5 pr-4" style={{ paddingLeft: `${1 + field.depth * 1.25}rem` }}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <code className="font-mono text-sm font-medium text-foreground">{name}</code>
                <span className="font-mono text-xs text-muted-foreground">{field.type}</span>
              </div>
              {field.description && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  <InlineText text={field.description} />
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Responses({ operation }: { operation: ApiOperation }) {
  return (
    <div>
      <SectionLabel>Responses</SectionLabel>
      <ul className="divide-y rounded-lg border">
        {operation.responses.map((r) => (
          <li key={r.status} className="flex gap-3 px-4 py-2.5">
            <div className="pt-0.5">
              <StatusBadge status={r.status} />
            </div>
            <div className="min-w-0 text-sm">
              <p className="text-muted-foreground">
                <InlineText text={r.description} />
              </p>
              {(r.contentTypes.some((t) => t !== "application/json") || r.headers.length > 0) && (
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {[...r.contentTypes.filter((t) => t !== "application/json"), ...r.headers.map((h) => `${h.name} header`)].join(
                    " · ",
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Operation({ operation }: { operation: ApiOperation }) {
  const success = operation.responses.find((r) => r.status.startsWith("2"));
  return (
    <section id={operation.id} className="scroll-mt-24 border-t py-12 first:border-t-0 first:pt-6">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:gap-10">
        <div className="min-w-0 space-y-6">
          <div>
            <h3 className="group text-2xl font-semibold tracking-tight">
              {operation.summary}
              <a
                href={`#${operation.id}`}
                className="ml-2 text-base font-normal no-underline opacity-0 group-hover:opacity-60"
                aria-label="Link to this endpoint"
              >
                #
              </a>
            </h3>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MethodBadge method={operation.method} />
              <code className="break-all font-mono text-sm text-foreground">{operation.path}</code>
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                {operation.authenticated ? (
                  <>
                    <Lock className="h-3 w-3" /> Bearer token
                  </>
                ) : (
                  <>
                    <LockOpen className="h-3 w-3" /> No authentication
                  </>
                )}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">operationId: {operation.id}</p>
          </div>
          {operation.description && <Markdown source={operation.description} className="text-[0.95rem]" />}
          <Parameters operation={operation} />
          <Responses operation={operation} />
          {success && <Fields response={success} />}
        </div>
        <div className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start">
          <CodeBlock code={operation.curl} lang="bash" title="Request" />
          {success?.example && <CodeBlock code={success.example} lang="json" title={`Response · ${success.status}`} />}
        </div>
      </div>
    </section>
  );
}

/** Endpoints by tag, for the sidebar (desktop) and the collapsible block (phone). */
export function ApiNav({ doc }: { doc: ApiDocument }) {
  return (
    <nav aria-label="API reference" className="text-sm">
      {doc.tags.map((tag) => (
        <div key={tag.id} className="mb-5 last:mb-0">
          <a
            href={`#${tag.id}`}
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {tag.name}
          </a>
          <ul className="space-y-0.5">
            {tag.operations.map((op) => (
              <li key={op.id}>
                <a
                  href={`#${op.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <MethodBadge method={op.method} className="px-1 text-[0.6rem]" />
                  <span className="truncate">{op.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function ApiReference({ doc }: { doc: ApiDocument }) {
  return (
    <div>
      <div className="grid gap-4 rounded-xl border bg-muted/30 p-5 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Base URL</p>
          <p className="mt-1">
            <code className="font-mono">{EXAMPLE_BASE_URL}</code> on the server, or your HTTPS proxy&rsquo;s URL.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Authentication</p>
          <p className="mt-1">
            <code className="font-mono">Authorization: Bearer $PULS_API_TOKEN</code> on every <code className="font-mono">/v1</code>{" "}
            route.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conventions</p>
          <p className="mt-1">
            Epoch-millisecond timestamps, half-open <code className="font-mono">[start, end)</code> ranges, days in{" "}
            <code className="font-mono">PULS_TIME_ZONE</code>. Errors are <code className="font-mono">{`{"error": "…"}`}</code>.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Specification</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <a href={SPEC_URL} download className="inline-flex items-center gap-1 text-brand hover:underline">
              <Download className="h-3.5 w-3.5" />
              openapi.json
            </a>
            <span className="text-muted-foreground">
              OpenAPI 3.1 · v{doc.version} · {doc.operationCount} endpoints
            </span>
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        New to the API? Start with the{" "}
        <Link href={docHref("api")} className="text-brand hover:underline">
          overview
        </Link>
        : reaching the service, choosing the user, paging, errors and rate limits.
      </p>

      {doc.tags.map((tag) => (
        <div key={tag.id} id={tag.id} className="mt-16 scroll-mt-24">
          <h2 className="text-3xl font-bold tracking-tight">{tag.name}</h2>
          {tag.description && <p className="mt-2 max-w-3xl text-muted-foreground">{tag.description}</p>}
          {tag.operations.map((operation) => (
            <Operation key={operation.id} operation={operation} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ApiBackLink() {
  return (
    <Link
      href="/docs"
      className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      All documentation
    </Link>
  );
}
