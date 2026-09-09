"use client";

import { useState, useEffect } from "react";

const words = ["Own", "Sync", "Query", "Export", "Keep"];

export function AnimatedWord() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible(false);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % words.length);
        setIsVisible(true);
      }, 400);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <span className="inline-block min-w-[14ch] text-center">
      <span
        className={`text-brand transition-all duration-400 ease-in-out ${
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
        }`}
      >
        {words[currentIndex]}
      </span>
    </span>
  );
}
