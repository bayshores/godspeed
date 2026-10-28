import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"
import { MousePointerClickIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * THE TOOLTIP (redesign 2026-10-27 — one tooltip for the whole app): a
 * dark box (bg-tip, #141414 on black) with a 1px tone-2 edge and a soft
 * shadow. It holds a bold title, optional small content, and an optional
 * "Click to …" hint row. Legends and explanations live here instead of
 * on the page.
 *
 * Opens after a 150ms hover and at once on keyboard focus (Radix opens on
 * focus, never on a click's focus); Escape closes it. The box is not
 * hoverable — it goes the moment the pointer leaves the trigger.
 *
 * Motion: the box fades in and out (.lh-fade reads Radix's data-state).
 *
 * Two ways in:
 * - <Tip title body hint>{trigger}</Tip> — rich content on any control.
 * - <Hint label> (src/components/ui/hint.tsx) — an icon's label + shortcut.
 * <TooltipCard> is the box alone, for surfaces that place it themselves
 * (an SVG map, a bar chart).
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

/** The box's look, shared by the Radix content and <TooltipCard>. */
const TOOLTIP_BOX =
  "flex w-max max-w-72 flex-col gap-2 border border-tone-2 bg-tip px-[13px] py-[11px] text-left text-xs text-ink-2 shadow-[0_0_28px_#000000e6]"

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn("lh-fade z-50", TOOLTIP_BOX, className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/** The box's rows: a bold title, any content, then the hint. */
function TooltipRows({
  title,
  children,
  hint,
}: {
  title?: React.ReactNode
  children?: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <>
      {title !== undefined && title !== null && (
        <div data-slot="tooltip-title" className="text-sm font-bold text-ink">
          {title}
        </div>
      )}
      {children}
      {hint !== undefined && hint !== null && (
        <div data-slot="tooltip-hint" className="flex items-center gap-1.5 text-ink-3">
          <MousePointerClickIcon className="size-3 shrink-0" aria-hidden />
          {hint}
        </div>
      )}
    </>
  )
}

/** The box alone (no trigger, no portal) — for surfaces that position it
 *  themselves. Same look as every hover tooltip. */
function TooltipCard({
  title,
  hint,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div role="tooltip" className={cn(TOOLTIP_BOX, className)} {...props}>
      <TooltipRows title={title} hint={hint}>
        {children}
      </TooltipRows>
    </div>
  )
}

interface TipProps {
  /** Bold first line. */
  title?: React.ReactNode
  /** Small content under the title (text, bars, answer blocks). */
  body?: React.ReactNode
  /** The full "Click to …" sentence; shown with the click icon. */
  hint?: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  /** Nothing to show: the trigger renders alone. */
  disabled?: boolean
  /** Extra classes for the box (e.g. a fixed width). */
  className?: string
  /** A single element that takes a ref — it becomes the trigger as-is. */
  children: React.ReactElement
}

/** A rich hover tooltip on any control: title, body, "Click to …" hint. */
function Tip({ title, body, hint, side = "top", align = "center", disabled, className, children }: TipProps) {
  if (disabled) return children
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} align={align} className={className}>
          <TooltipRows title={title} hint={hint}>
            {body}
          </TooltipRows>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipCard, TooltipRows, Tip }
