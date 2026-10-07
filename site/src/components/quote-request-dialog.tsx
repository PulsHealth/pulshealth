"use client";

import * as React from "react";
import { FormDialog, FormDialogConfig } from "./form-dialog";

interface QuoteRequestDialogProps {
  children: React.ReactNode;
}

const consultingConfig: FormDialogConfig = {
  title: "Get in touch",
  description:
    "Tell me what you are working on. I read every message myself and reply from support@pulshealth.com.",
  successTitle: "Got it",
  successDescription: "Thanks. I will reply within a few days.",
  submitLabel: "Send",
  submittingLabel: "Sending...",
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
    {
      id: "company",
      label: "Organisation",
      type: "text",
      placeholder: "If there is one (optional)",
      required: false,
    },
    {
      id: "message",
      label: "What are you working on?",
      type: "textarea",
      placeholder: "The data you have, what you want from it, and where you are stuck.",
      required: true,
    },
  ],
  hiddenFields: {
    source: "consulting",
  },
};

export function QuoteRequestDialog({ children }: QuoteRequestDialogProps) {
  return <FormDialog config={consultingConfig}>{children}</FormDialog>;
}
