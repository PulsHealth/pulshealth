"use client";

import * as React from "react";
import { FormDialog, FormDialogConfig } from "./form-dialog";

interface QuoteRequestDialogProps {
  children: React.ReactNode;
}

const quoteRequestConfig: FormDialogConfig = {
  title: "Get a Quote",
  description: "Fill in your details and we'll get back to you with a custom quote.",
  successTitle: "Thank you!",
  successDescription: "We'll be in touch shortly to discuss your requirements.",
  submitLabel: "Submit Request",
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
      placeholder: "you@company.com",
      required: true,
    },
    {
      id: "company",
      label: "Company",
      type: "text",
      placeholder: "Your company (optional)",
      required: false,
    },
    {
      id: "message",
      label: "Message",
      type: "textarea",
      placeholder: "Tell us about your project or requirements...",
      required: false,
    },
  ],
};

export function QuoteRequestDialog({ children }: QuoteRequestDialogProps) {
  return <FormDialog config={quoteRequestConfig}>{children}</FormDialog>;
}
