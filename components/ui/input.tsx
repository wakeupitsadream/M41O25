"use client";

import { forwardRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { maskTime, toHm } from "@/lib/time-mask";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-md bg-surface-2 px-4 py-3 text-[15px] text-fg placeholder:text-dim outline-none ring-1 ring-border transition focus:ring-accent/70 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(base, className)} {...props} />;
});

/**
 * Дата. Safari на iPhone рисует своё поле, которое не сжимается и обрезает значение справа:
 * снимаем нативный вид, разрешаем сжиматься (min-w-0) и прижимаем значение влево.
 */
export const DateInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function DateInput(
  { className, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="date"
      className={cn(
        // min-h — чтобы поле осталось тап-таргетом, даже если Safari схлопнет высоту значения.
        "min-h-12 min-w-0 appearance-none [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left",
        className,
      )}
      {...props}
    />
  );
});

type TimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  /** Отдаёт готовое «ЧЧ:ММ» либо пустую строку — то же, что уходило с нативного поля. */
  onChange?: (value: string) => void;
};

/**
 * Время пары. Вместо `input[type="time"]`: нативное поле на iPhone с английской локалью
 * системы показывает «8:30 AM», занимает лишнюю ширину и вылезает из карточки.
 * Здесь цифровая клавиатура и маска ЧЧ:ММ: «830» → «08:30». Наружу всегда «ЧЧ:ММ» или пусто.
 */
export function TimeInput({ value, defaultValue, onChange, name, className, onBlur, ...props }: TimeInputProps) {
  const [text, setText] = useState(() => maskTime(value ?? defaultValue ?? ""));
  // Что мы сами отдали наружу: пока `value` совпадает с этим, набранное «08:3» не затирается.
  const [emitted, setEmitted] = useState(() => toHm(value ?? defaultValue ?? ""));

  // Значение пришло со стороны (открыли другую пару в шторке) — показываем его.
  if (value !== undefined && value !== emitted) {
    setEmitted(value);
    setText(maskTime(value));
  }

  const emit = (next: string) => {
    const normal = toHm(next);
    setEmitted(normal);
    onChange?.(normal);
    return normal;
  };

  return (
    <>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder="ЧЧ:ММ"
        value={text}
        className={cn("tnum", className)}
        onChange={(e) => {
          const next = maskTime(e.target.value);
          setText(next);
          emit(next);
        }}
        onBlur={(e) => {
          setText(emit(text));
          onBlur?.(e);
        }}
      />
      {name && <input type="hidden" name={name} value={toHm(text)} />}
    </>
  );
}

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
