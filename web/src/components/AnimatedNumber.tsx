"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionValue, animate, useInView } from "framer-motion";

type FormatType = "integer" | "decimal1" | "percent1" | "percent0";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  className?: string;
  /**
   * Output format.
   * - "integer": 674 (default, with fr-FR locale thousands)
   * - "decimal1": 63.9
   * - "percent1": 63.9%
   * - "percent0": 64%
   */
  format?: FormatType;
  startOnView?: boolean;
}

/**
 * Animates a number from 0 to its target value when it enters the viewport.
 *
 * IMPORTANT: The `format` prop is a STRING (not a function), because this
 * component is imported from Server Components and Next.js App Router
 * forbids passing functions across the server/client boundary.
 */
export function AnimatedNumber({
  value,
  duration = 1.6,
  className = "",
  format = "integer",
  startOnView = true,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const [display, setDisplay] = useState("0");
  const motionValue = useMotionValue(0);

  useEffect(() => {
    if (!startOnView || isInView) {
      const controls = animate(motionValue, value, {
        duration,
        ease: [0.16, 1, 0.3, 1],
      });
      return () => controls.stop();
    }
  }, [isInView, motionValue, value, duration, startOnView]);

  useEffect(() => {
    const unsub = motionValue.on("change", (latest) => {
      setDisplay(formatValue(latest, format));
    });
    return unsub;
  }, [motionValue, format]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}

function formatValue(n: number, fmt: FormatType): string {
  switch (fmt) {
    case "decimal1":
      return n.toFixed(1);
    case "percent1":
      return `${n.toFixed(1)}%`;
    case "percent0":
      return `${Math.round(n)}%`;
    case "integer":
    default:
      return Math.round(n).toLocaleString("fr-FR");
  }
}
