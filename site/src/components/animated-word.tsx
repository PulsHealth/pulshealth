"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const FADE_MS = 300;

/**
 * The home page headline's first word, cycling. The word fades out, its slot
 * eases to the next word's width while nothing is showing, then the next word
 * fades in: one word at a time, and a centred line stays centred instead of
 * leaving a gap the width of the longest word. Screen readers get the first
 * word only, and reduced motion stops the cycle.
 */
export function AnimatedWord({
  words,
  interval = 2600,
  className,
}: {
  words: string[];
  interval?: number;
  className?: string;
}) {
  const [current, setCurrent] = useState(0);
  const [shown, setShown] = useState(true);
  const [widths, setWidths] = useState<number[] | null>(null);
  const measures = useRef<(HTMLSpanElement | null)[]>([]);

  // Each word's rendered width, re-measured when the font loads or the
  // headline's size changes with the viewport.
  useLayoutEffect(() => {
    const measure = () =>
      setWidths(measures.current.map((el) => (el ? el.getBoundingClientRect().width : 0)));
    measure();
    document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    measures.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [words]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = setInterval(() => {
      setShown(false);
      timers.push(setTimeout(() => setCurrent((i) => (i + 1) % words.length), FADE_MS));
      timers.push(setTimeout(() => setShown(true), FADE_MS * 2));
    }, interval);
    return () => {
      clearInterval(tick);
      timers.forEach(clearTimeout);
    };
  }, [words.length, interval]);

  return (
    <span
      className={cn("relative inline-block whitespace-nowrap transition-[width] duration-300 ease-in-out", className)}
      style={widths ? { width: widths[current] } : undefined}
    >
      <span className="sr-only">{words[0]}</span>
      {words.map((word, i) => (
        <span
          key={word}
          ref={(el) => {
            measures.current[i] = el;
          }}
          aria-hidden
          className="invisible absolute left-0 top-0"
        >
          {word}
        </span>
      ))}
      <span
        aria-hidden
        className={cn(
          "inline-block text-brand transition-[opacity,transform] duration-300 ease-out",
          shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {words[current]}
      </span>
    </span>
  );
}
