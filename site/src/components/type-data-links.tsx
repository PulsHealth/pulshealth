"use client";

import { ArrowUpRight } from "lucide-react";
import { AppStoreBadge } from "@/components/app-store-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function TypeDataLinks({ exampleHref, dashboardHref }: {
  exampleHref: string | null;
  dashboardHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm">
      {exampleHref && (
        <a href={exampleHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">
          See real example data <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </a>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">
            Explore your own <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="pr-6 leading-snug">Explore your Apple Health data</DialogTitle>
            <DialogDescription>Explore Apple Health on your iPhone with PulsHealth. No account or server needed.</DialogDescription>
          </DialogHeader>
          <div className="py-2"><AppStoreBadge /></div>
          <div className="border-t pt-4 text-sm">
            <p className="mb-2 text-muted-foreground">Already syncing to the PulsHealth dashboard?</p>
            <a href={dashboardHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">
              Sign in to your dashboard <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
