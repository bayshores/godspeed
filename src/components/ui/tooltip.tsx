import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * THE TOOLTIP: flat, no blur, no shadow. Two looks:
 * - the box: solid bg-tip with a 1px tone-2 edge, a bold title and small
 *   content under it (<Tip title body>);
 * - the tag: white with black text, one short label (<Hint label>, in
 *   src/components/ui/hint.tsx).
 *
 * Opens after a 150ms hover and at once on keyboard focus (Radix opens on
 * focus, never on a click's focus); Escape closes it. The box is not
 * hoverable — it goes the moment the pointer leaves the trigger.
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

function Tooltip({
  disableHoverableContent = true,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      disableHoverableContent={disableHoverableContent}
      {...props}
    />
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

const BOX =
  "flex w-max max-w-72 flex-col gap-1.5 border border-tone-2 bg-tip px-3 py-2.5 text-left text-xs text-ink-2"
const TAG = "w-max max-w-72 bg-ink px-2 py-1 text-[12.5px] font-semibold text-background"

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
        className={cn("lh-fade z-50", tag ? TAG : BOX, className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

interface TipProps {
  /** Bold first line. */
  title?: React.ReactNode
  /** Small content under the title (text, bars, answer blocks). */
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
            <div data-slot="tooltip-title" className="text-sm font-bold text-ink">
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
