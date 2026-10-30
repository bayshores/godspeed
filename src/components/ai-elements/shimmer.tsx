import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { memo } from "react";

interface TextShimmerProps {
  children: string;
  className?: string;
}

/** One sweep a second, two pixels of highlight per character. */
const ShimmerComponent = ({ children, className }: TextShimmerProps) => {
  return (
    <motion.p
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={
        {
          "--spread": `${children.length * 2}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
      transition={{
        duration: 1,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </motion.p>
  );
};

export const Shimmer = memo(ShimmerComponent);
