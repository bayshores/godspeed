import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/frontend/lib/utils"

/**
 * THE TOOLTIP: flat, no blur, no shadow. Two looks:
 * - the box: made of the top bar like every pop-up (lh-popup), so it reads
 *   the same on every background, a title and quiet content under it, both
 *   at the interface size (<Tip title body>);
 * - the tag: white with black text, one short label (<Hint label>, in
 *   src/frontend/components/ui/hint.tsx).
 *
 * Opens after a 150ms hover and at once on keyboard focus (Radix opens on
 * focus, never on a click's focus); Escape closes it. The pointer can
 * move onto the box to read it (WCAG 1.4.13); it goes once it leaves both.
 * Motion: it fades in and out (.lh-fade reads Radix's data-state).
 */

/** The hover delay (ms). Focus opens at once. */
export const TOOLTIP_DELAY_MS = 150

function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

const BOX =
  "lh-popup flex w-max max-w-72 flex-col gap-1.5 px-3 py-2.5 text-left text-ui text-ink-2"
const TAG = "w-max max-w-72 bg-ink px-2 py-1 text-(length:--text-sm) font-semibold text-background"

function TooltipContent({
  className,
  sideOffset = 6,
  tag = false,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & { tag?: boolean }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn("lh-fade z-(--lh-z-dialog)", tag ? TAG : BOX, className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

interface TipProps {
  /** First line, in ink. */
  title?: React.ReactNode
  /** Quiet content under the title (text, bars, answer blocks). */
  body?: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  /** Nothing to show: the trigger renders alone. */
  disabled?: boolean
  /** Extra classes for the box (e.g. a fixed width). */
  className?: string
  /** A single element that takes a ref — it becomes the trigger as-is. */
  children: React.ReactElement
}

/** A hover box on any control: title and body. */
function Tip({ title, body, side = "top", align = "center", disabled, className, children }: TipProps) {
  if (disabled) return children
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} align={align} className={className}>
          {title !== undefined && title !== null && (
            <div data-slot="tooltip-title" className="font-medium text-ink">
              {title}
            </div>
          )}
          {body}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Tip }
