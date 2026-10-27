"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

const prompt = "Help me set up PulsHealth on my server. Read https://pulshealth.com/llms.txt and https://pulshealth.com/docs/setup/ first. Check my machine, network and existing installation, then follow the guide. Preserve existing data and keep secrets out of chat. Help me pair my iPhone and verify that synced data arrived.";

export function AiSetupPrompt() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <p className="border-b px-5 py-4 text-sm font-medium text-muted-foreground">Set up with a coding assistant</p>
      <p className="select-text px-5 py-6 text-lg leading-relaxed">{prompt}</p>
      <p className="px-5 pb-5 text-sm text-muted-foreground">
        Use an assistant with terminal access to your server, or follow the{" "}
        <Link href="/docs/setup/" className="text-brand underline underline-offset-4">setup guide</Link> yourself.
      </p>
      <div className="flex flex-wrap items-center gap-4 px-5 pb-5">
        <Button onClick={copyPrompt}>
          {status === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {status === "copied" ? "Prompt copied" : "Copy setup prompt"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {status === "failed" ? "Couldn’t copy. Select the prompt above to copy it manually." : status === "copied" ? "Paste it into your coding assistant." : "Bring your own server."}
        </p>
      </div>
    </div>
  );
}
