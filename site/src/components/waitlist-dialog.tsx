"use client";

import * as React from "react";
import { FormDialog, FormDialogConfig } from "./form-dialog";

interface WaitlistDialogProps {
  children: React.ReactNode;
}

const waitlistConfig: FormDialogConfig = {
  title: "Join Waitlist",
  description: "Be the first to know when AI-powered health insights are available.",
  successTitle: "You're on the list!",
  successDescription: "We'll notify you when AI health insights are available.",
  submitLabel: "Join Waitlist",
  submittingLabel: "Joining...",
  fields: [
    {
      id: "name",
      label: "Name",
      type: "text",
      placeholder: "Your name",
      required: true,
    },
    {
      id: "email",
      label: "Email",
      type: "email",
      placeholder: "you@example.com",
      required: true,
    },
  ],
  hiddenFields: {
    source: "ai-waitlist",
  },
};

export function WaitlistDialog({ children }: WaitlistDialogProps) {
  return <FormDialog config={waitlistConfig}>{children}</FormDialog>;
}
