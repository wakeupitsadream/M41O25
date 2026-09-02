"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Обзор", exact: true, min: "moderator" },
  { href: "/admin/schedule", label: "Расписание", min: "admin" },
  { href: "/admin/users", label: "Люди", min: "admin" },
  { href: "/admin/subjects", label: "Предметы", min: "admin" },
  { href: "/admin/semesters", label: "Семестры", min: "admin" },
  { href: "/admin/settings", label: "Настройки", min: "admin" },
] as const;

export function AdminNav({ role }: { role: "admin" | "moderator" | "student" }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-2 overflow-x-auto px-5 py-2 scrollbar-none">
      {items
        .filter((i) => role === "admin" || i.min === "moderator")
        .map((i) => {
          const active = "exact" in i && i.exact ? pathname === i.href : pathname.startsWith(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition",
                active ? "bg-fg text-bg" : "bg-surface-2 text-muted hairline",
              )}
            >
              {i.label}
            </Link>
          );
        })}
    </nav>
  );
}
