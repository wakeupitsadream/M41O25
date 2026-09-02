"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/input";
import { SubmitButton } from "./forms";
import { USER_COLORS, cn } from "@/lib/utils";

const EMOJI = ["🙂", "😎", "🦊", "🐼", "🐨", "🦁", "🐯", "🐸", "🐙", "🦄", "🐳", "🦋", "🌚", "🔥", "⚡", "🎧", "🎸", "🧠", "🧑‍💻", "🏀"];

type Values = {
  fullName?: string;
  nickname?: string | null;
  avatarEmoji?: string;
  color?: string;
  role?: "admin" | "moderator" | "student";
  birthday?: string | null;
};

export function UserForm({ action, values, isSelf, submitLabel }: { action: (fd: FormData) => Promise<void>; values?: Values; isSelf?: boolean; submitLabel: string }) {
  const [color, setColor] = useState(values?.color ?? USER_COLORS[0]);
  const [emoji, setEmoji] = useState(values?.avatarEmoji ?? "🙂");
  return (
    <form action={action} className="space-y-4">
      <Field label="Фамилия Имя">
        <Input name="fullName" defaultValue={values?.fullName ?? ""} placeholder="Иванова Анастасия" required autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ник (необязательно)">
          <Input name="nickname" defaultValue={values?.nickname ?? ""} placeholder="Настя" />
        </Field>
        <Field label="День рождения">
          <Input type="date" name="birthday" defaultValue={values?.birthday ?? ""} />
        </Field>
      </div>
      <Field label="Роль">
        <Select name="role" defaultValue={values?.role ?? "student"} disabled={isSelf}>
          <option value="student">Студент</option>
          <option value="moderator">Староста (модератор)</option>
          <option value="admin">Админ</option>
        </Select>
      </Field>
      <div className="space-y-1.5">
        <span className="block text-[13px] font-medium text-muted">Цвет</span>
        <input type="hidden" name="color" value={color} />
        <div className="flex flex-wrap gap-2">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn("size-9 rounded-full transition", color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-bg" : "")}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <span className="block text-[13px] font-medium text-muted">Аватар</span>
        <input type="hidden" name="avatarEmoji" value={emoji} />
        <div className="flex flex-wrap gap-1.5">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={cn("grid size-10 place-items-center rounded-full text-xl", emoji === e ? "bg-fg/10 ring-2 ring-fg" : "bg-surface-2")}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <SubmitButton className="w-full" size="lg">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
