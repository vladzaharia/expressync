import * as preact from "preact";
import { useEffect, useState } from "preact/hooks";
import { cn } from "@/src/lib/utils/cn.ts";
import type { ComponentChildren } from "preact";

interface Sparkle {
  id: string;
  x: string;
  y: string;
  color: string;
  delay: number;
  scale: number;
  lifespan: number;
}

interface SparklesTextProps {
  children: ComponentChildren;
  className?: string;
  sparklesCount?: number;
  colors?: {
    first: string;
    second: string;
  };
}

const generateSparkle = (
  colors: { first: string; second: string },
): Sparkle => {
  return {
    id: Math.random().toString(36).substring(2),
    x: `${Math.random() * 100}%`,
    y: `${Math.random() * 100}%`,
    color: Math.random() > 0.5 ? colors.first : colors.second,
    delay: Math.random() * 2,
    scale: Math.random() * 1 + 0.3,
    lifespan: Math.random() * 10 + 5,
  };
};

interface SparkleIconProps {
  color: string;
  className?: string;
  style?: preact.JSX.CSSProperties;
}

const SparkleIcon = (
  { color, className, style }: SparkleIconProps,
) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 160 160"
    fill="none"
    className={className}
    style={style}
  >
    <path
      d="M80 0C80 0 84.2846 41.2925 101.496 58.504C118.707 75.7154 160 80 160 80C160 80 118.707 84.2846 101.496 101.496C84.2846 118.707 80 160 80 160C80 160 75.7154 118.707 58.504 101.496C41.2925 84.2846 0 80 0 80C0 80 41.2925 75.7154 58.504 58.504C75.7154 41.2925 80 0 80 0Z"
      fill={color}
    />
  </svg>
);

export function SparklesText({
  children,
  className,
  sparklesCount = 10,
  colors = { first: "oklch(0.75 0.15 200)", second: "oklch(0.75 0.22 145)" },
}: SparklesTextProps) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    const generatedSparkles = Array.from(
      { length: sparklesCount },
      () => generateSparkle(colors),
    );
    setSparkles(generatedSparkles);

    const interval = setInterval(() => {
      setSparkles((currentSparkles) =>
        currentSparkles.map((sparkle) =>
          sparkle.lifespan <= 0
            ? generateSparkle(colors)
            : { ...sparkle, lifespan: sparkle.lifespan - 0.1 }
        )
      );
    }, 100);

    return () => clearInterval(interval);
  }, [sparklesCount, colors.first, colors.second]);

  return (
    <span className={cn("relative inline-block", className)}>
      {sparkles.map((sparkle) => (
        <span
          key={sparkle.id}
          className="pointer-events-none absolute z-20 animate-sparkle"
          style={{
            left: sparkle.x,
            top: sparkle.y,
            animationDelay: `${sparkle.delay}s`,
          }}
        >
          <SparkleIcon
            color={sparkle.color}
            className="size-2.5"
            style={{ transform: `scale(${sparkle.scale})` }}
          />
        </span>
      ))}
      <span className="relative z-10">{children}</span>
    </span>
  );
}
