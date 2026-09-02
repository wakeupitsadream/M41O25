import { Wordmark } from "@/components/ui/primitives";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-10 pt-safe">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(200,255,46,0.18),transparent_70%)]"
      />
      <header className="relative flex items-center justify-between pt-8">
        <Wordmark className="text-2xl" />
      </header>
      <div className="relative flex flex-1 flex-col justify-center py-10">{children}</div>
    </main>
  );
}
