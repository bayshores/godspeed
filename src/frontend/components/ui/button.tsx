import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/frontend/lib/utils"

// lh-press: eased hover colors and a 97% press-down; disabled buttons never press.
const buttonVariants = cva(
  "lh-press inline-flex shrink-0 items-center justify-center gap-2 text-sm font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border-2 border-foreground hover:bg-accent",
        ghost:
          "hover:bg-accent",
      },
      size: {
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
