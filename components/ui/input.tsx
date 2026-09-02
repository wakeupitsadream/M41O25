"use client";

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md bg-surface-2 px-4 py-3 text-[15px] text-fg placeholder:text-dim outline-none ring-1 ring-border transition focus:ring-accent/70 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(base, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(base, "min-h-24 resize-none leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(base, "appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239C9CA8%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children }: { label?: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="block text-[13px] font-medium text-muted">{label}</span>}
      {children}
      {error ? <span className="block text-[13px] text-danger">{error}</span> : hint ? <span className="block text-[13px] text-dim">{hint}</span> : null}
    </label>
  );
}
