import type { Metadata, Viewport } from "next";
import { Inter, Unbounded } from "next/font/google";
import { MotionConfig } from "motion/react";
import "./globals.css";
import { ChunkReload } from "@/components/features/chunk-reload";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

// Только используемые веса: 700 — заголовки (font-display + font-bold), 500 — поля кода и PIN (font-display без
// явного веса: браузер берёт ближайший объявленный). Лишние веса — лишние @font-face и preload-файлы.
const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  display: "swap",
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: { default: "Raspison", template: "%s · Raspison" },
  description: "Расписание, домашка и жизнь группы — в одном месте",
  applicationName: "Raspison",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Raspison",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0e",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${unbounded.variable}`}>
      <body className="bg-bg text-fg antialiased">
        <ChunkReload />
        {/* «Уменьшение движения» в iOS: Motion анимирует инлайн-стилями, и CSS-правило в globals.css его не касается. */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </body>
    </html>
  );
}
