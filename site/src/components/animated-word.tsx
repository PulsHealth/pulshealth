"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const FADE_MS = 300;

/**
 * The home page headline's first word, cycling on a line of its own, so the
 * rest of the headline never moves. One word fades out before the next fades
 * in. Screen readers get the first word only, and reduced motion stops the
 * cycle.
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

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tick = setInterval(() => {
      setShown(false);
      timers.push(
        setTimeout(() => {
          setCurrent((i) => (i + 1) % words.length);
          setShown(true);
        }, FADE_MS),
      );
    }, interval);
    return () => {
      clearInterval(tick);
      timers.forEach(clearTimeout);
    };
  }, [words.length, interval]);

  return (
    <span className={cn("block", className)}>
      <span className="sr-only">{words[0]}</span>
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
