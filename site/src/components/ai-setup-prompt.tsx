"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

const prompt = "Help me set up PulsHealth on my server so I can sync my Apple Health data and connect my AI assistant. Start by reading https://pulshealth.com/llms.txt. Ask me about my server and network before making changes.";

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
      <p className="border-b px-5 py-4 text-sm font-medium text-muted-foreground">A starting prompt for your coding assistant</p>
      <p className="select-text px-5 py-6 text-lg leading-relaxed">{prompt}</p>
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
