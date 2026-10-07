"use client";

import { useEffect, useState } from "react";

/**
 * The home page headline's first word, cycling. Every word sits in the same
 * grid cell, so the line is always as wide as the longest one and nothing
 * around it moves. Screen readers get the first word only, and reduced motion
 * stops the cycle.
 */
export function AnimatedWord({ words, interval = 2200 }: { words: string[]; interval?: number }) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setCurrent((i) => (i + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);

  return (
    <span className="inline-grid">
      <span className="sr-only">{words[0]}</span>
      {words.map((word, i) => (
        <span
          key={word}
          aria-hidden
          className={`col-start-1 row-start-1 text-brand transition-all duration-500 ease-out ${
            i === current ? "translate-y-0 opacity-100" : i === (current - 1 + words.length) % words.length ? "-translate-y-3 opacity-0" : "translate-y-3 opacity-0"
          }`}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
