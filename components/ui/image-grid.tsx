"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { cn } from "@/lib/utils";

export type GridImage = { id: string; url: string; name: string };

/** Смахивание считается перелистыванием от этого сдвига (px) или скорости (px/с). */
const SWIPE_OFFSET = 60;
const SWIPE_VELOCITY = 400;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Сетка фото с просмотром внутри приложения. Установленная на iPhone PWA открывает внешние ссылки
 * в отдельном браузере без нашей cookie, поэтому фото не уводим наружу, а показываем поверх экрана.
 *
 * Просмотр: тап по фото переключает «вписать ↔ 1:1» — в натуральную величину панорамируем нативной прокруткой
 * (так читается почерк на доске), смахивание влево/вправо в режиме «вписать» листает фото.
 * Долгое нажатие на картинку должно сохранять её, поэтому на <img> нет select-none и touch-callout: none,
 * а перетаскивание ведём через dragControls — иначе Motion сам навесил бы их на перетаскиваемый слой.
 */
export function ImageGrid({ images, className, rounded = "rounded-lg", singleMax = "max-h-96" }: { images: GridImage[]; className?: string; rounded?: string; singleMax?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  // «fit» — вписано в экран, «full» — натуральная величина с панорамированием.
  const [zoom, setZoom] = useState<"fit" | "full">("fit");
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // Куда тапнули в режиме «вписать» (доли ширины и высоты картинки) — эту точку центрируем после перехода в 1:1.
  const zoomAt = useRef({ rx: 0.5, ry: 0.5 });
  // Идёт смахивание: тап по фото и клик по фону в этом жесте — не команды.
  const swiping = useRef(false);
  const dragControls = useDragControls();

  const step = useCallback(
    (delta: number) => {
      if (open === null) return;
      const next = Math.min(images.length - 1, Math.max(0, open + delta));
      if (next === open) return;
      setZoom("fit");
      setOpen(next);
    },
    [open, images.length],
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  // Фокус: при открытии — на «Закрыть», при закрытии — обратно на миниатюру просмотренного фото.
  const lastOpen = useRef<number | null>(null);
  useEffect(() => {
    const was = lastOpen.current;
    lastOpen.current = open;
    if (open !== null && was === null) closeBtn.current?.focus();
    else if (open === null && was !== null) thumbs.current[was]?.focus();
  }, [open]);

  // Соседние фото подгружаем заранее, чтобы перелистывание не показывало пустоту.
  const prevUrl = open !== null ? images[open - 1]?.url : undefined;
  const nextUrl = open !== null ? images[open + 1]?.url : undefined;
  useEffect(() => {
    for (const url of [prevUrl, nextUrl]) if (url) new Image().src = url;
  }, [prevUrl, nextUrl]);

  // После перехода в 1:1 прокручиваем к точке тапа — до отрисовки кадра, чтобы картинка не прыгала от левого верхнего угла.
  useLayoutEffect(() => {
    const sc = scroller.current;
    const el = img.current;
    if (zoom !== "full" || !sc || !el) return;
    const { rx, ry } = zoomAt.current;
    const area = sc.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    sc.scrollLeft = r.left - area.left + sc.scrollLeft + rx * r.width - sc.clientWidth / 2;
    sc.scrollTop = r.top - area.top + sc.scrollTop + ry * r.height - sc.clientHeight / 2;
  }, [zoom]);

  if (images.length === 0) return null;
  const current = open !== null ? images[open] : null;

  const show = (i: number) => {
    setZoom("fit");
    setOpen(i);
  };
  const close = () => setOpen(null);

  const onTap = (_: unknown, info: PanInfo) => {
    if (swiping.current) return;
    const el = img.current;
    if (!el) return;
    if (zoom === "full") {
      setZoom("fit");
      return;
    }
    // В 1:1 есть смысл, только если картинка крупнее, чем показана сейчас.
    if (el.naturalWidth <= el.clientWidth && el.naturalHeight <= el.clientHeight) return;
    // info.point — координаты страницы, прямоугольник — окна: вычитаем прокрутку документа.
    const r = el.getBoundingClientRect();
    zoomAt.current = { rx: clamp01((info.point.x - window.scrollX - r.left) / r.width), ry: clamp01((info.point.y - window.scrollY - r.top) / r.height) };
    setZoom("full");
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    // onDragEnd приходит после click/onTap того же жеста (postRender), так что они ещё видят флаг.
    swiping.current = false;
    const dx = info.offset.x;
    const vx = info.velocity.x;
    if (dx < -SWIPE_OFFSET || vx < -SWIPE_VELOCITY) step(1);
    else if (dx > SWIPE_OFFSET || vx > SWIPE_VELOCITY) step(-1);
  };

  return (
    <>
      <div className={cn("grid gap-2", images.length === 1 ? "grid-cols-1" : "grid-cols-2", className)}>
        {images.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => {
              thumbs.current[i] = el;
            }}
            type="button"
            onClick={() => show(i)}
            aria-label={`Открыть фото ${a.name}`}
            className={cn("block overflow-hidden hairline", rounded)}
          >
            <img src={a.url} alt={a.name} className={cn("w-full object-cover", images.length === 1 ? singleMax : "aspect-square")} loading="lazy" />
          </button>
        ))}
      </div>
      <AnimatePresence>
        {current && open !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={current.name}
            // touch-none на оверлее: жесты вне прокручиваемой области не тянут страницу под ним.
            className="fixed inset-0 z-50 touch-none bg-black/92"
          >
            {/* Прокручиваемая область на весь экран: в 1:1 панорамируем нативной прокруткой, overscroll-contain
                не даёт цепочке прокрутки уйти на страницу под оверлеем. */}
            <div ref={scroller} className="absolute inset-0 overflow-auto overscroll-contain touch-pan-x touch-pan-y">
              <div
                className="flex min-h-full min-w-full p-2"
                onClick={(e) => {
                  // Клик после смахивания прилетает на общего предка начала и конца жеста — его не считаем.
                  if (e.target === e.currentTarget && !swiping.current) close();
                }}
              >
                {/* m-auto, а не justify-center: при переполнении auto-отступы обнуляются и левый край остаётся достижим прокруткой. */}
                <motion.div
                  className={cn("m-auto", zoom === "fit" && "touch-pan-y")}
                  drag={zoom === "fit" ? "x" : false}
                  dragListener={false}
                  dragControls={dragControls}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.5}
                  dragMomentum={false}
                  onPointerDown={(e) => {
                    if (zoom === "fit") dragControls.start(e);
                  }}
                  onDragStart={() => {
                    swiping.current = true;
                  }}
                  onDragEnd={onDragEnd}
                  onTap={onTap}
                  onClick={(e) => e.stopPropagation()}
                >
                  <img
                    key={current.id}
                    ref={img}
                    src={current.url}
                    alt={current.name}
                    draggable={false}
                    className={cn("block", zoom === "fit" ? "max-h-[92dvh] max-w-[calc(100vw-1rem)]" : "max-h-none max-w-none")}
                    style={{ WebkitTouchCallout: "default" } as CSSProperties}
                  />
                </motion.div>
              </div>
            </div>
            <button
              ref={closeBtn}
              type="button"
              aria-label="Закрыть"
              onClick={close}
              className="absolute right-4 z-10 grid size-11 place-items-center rounded-full bg-white/10 text-white active:bg-white/20"
              style={{ top: "calc(var(--sat) + 0.75rem)" }}
            >
              <X className="size-5" />
            </button>
            {images.length > 1 && (
              <div
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/80 tnum"
                style={{ bottom: "calc(var(--sab) + 1rem)" }}
              >
                {open + 1} / {images.length}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
