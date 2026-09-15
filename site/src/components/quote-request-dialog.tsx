"use client";

import * as React from "react";
import { FormDialog, FormDialogConfig } from "./form-dialog";

interface QuoteRequestDialogProps {
  children: React.ReactNode;
}

const consultingConfig: FormDialogConfig = {
  title: "Tell me what you're building",
  description:
    "What you have, what you want it to do, and what is in the way. I read every message myself and reply from support@pulshealth.com.",
  successTitle: "Got it",
  successDescription:
    "I will reply within a few days. If the answer is already in the docs, I will point you at it instead of quoting for it.",
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
      label: "What are you trying to do?",
      type: "textarea",
      placeholder: "The setup you have, the outcome you want, and anything already tried.",
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
