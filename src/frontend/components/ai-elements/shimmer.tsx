import { cn } from "@/frontend/lib/utils";
import type { CSSProperties } from "react";
import { memo } from "react";

interface TextShimmerProps {
  children: string;
  className?: string;
}

/** One sweep a second, two pixels of highlight per character. */
const ShimmerComponent = ({ children, className }: TextShimmerProps) => {
  return (
    <p
      className={cn(
        "relative inline-block animate-[lh-shimmer_1s_linear_infinite] bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      )}
      style={
        {
          "--spread": `${children.length * 2}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
    >
      {children}
    </p>
  );
};

export const Shimmer = memo(ShimmerComponent);
