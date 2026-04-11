"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate, useInView } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
  startOnView?: boolean;
}

/**
 * Animates a number from 0 to its target value when it enters the viewport.
 * Uses Framer Motion's spring-based animate() for a natural, ease-out curve.
 *
 * Usage:
 *   <AnimatedNumber value={674} className="font-data text-6xl font-black text-gold" />
 *   <AnimatedNumber value={64.4} format={(n) => `${n.toFixed(1)}%`} />
 */
export function AnimatedNumber({
  value,
  duration = 1.6,
  className = "",
  format = (n) => Math.round(n).toLocaleString("fr-FR"),
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
        ease: [0.16, 1, 0.3, 1], // smooth ease-out
      });
      return () => controls.stop();
    }
  }, [isInView, motionValue, value, duration, startOnView]);

  useEffect(() => {
    const unsub = motionValue.on("change", (latest) => {
      setDisplay(format(latest));
    });
    return unsub;
  }, [motionValue, format]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
