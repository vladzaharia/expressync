import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import type { ComponentProps } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";

interface NumberTickerProps extends ComponentProps<"span"> {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number;
  decimalPlaces?: number;
  duration?: number;
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  duration = 2000,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [displayValue, setDisplayValue] = useState(direction === "down" ? value : startValue);
  const [hasAnimated, setHasAnimated] = useState(false);

  const animateValue = useCallback((start: number, end: number, dur: number) => {
    const startTime = performance.now();
    
    const tick = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / dur, 1);
      
      // Easing function (ease-out)
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * easeOut;
      
      setDisplayValue(current);
      
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };
    
    requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (hasAnimated) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          const timer = setTimeout(() => {
            const start = direction === "down" ? value : startValue;
            const end = direction === "down" ? startValue : value;
            animateValue(start, end, duration);
          }, delay * 1000);
          return () => clearTimeout(timer);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [value, direction, startValue, delay, duration, hasAnimated, animateValue]);

  const formattedValue = Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(Number(displayValue.toFixed(decimalPlaces)));

  return (
    <span
      ref={ref}
      className={cn(
        "inline-block tracking-wider tabular-nums",
        className
      )}
      {...props}
    >
      {formattedValue}
    </span>
  );
}

