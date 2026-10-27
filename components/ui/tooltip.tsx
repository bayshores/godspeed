"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The styled tooltip (tooltip wave → subtlety round, owner 2026-09-25):
 * a quiet dark chip, not a white slab — accent tone (the hover-chip color),
 * 11px, minimal padding, no arrow (nothing purely decorative). Opens after
 * a 500ms rest, so tooltips appear when you pause on a control, never in
 * passing; disableHoverableContent means the chip is un-hoverable — the
 * instant the cursor leaves the trigger it's gone, even mid-move onto the
 * chip's own pixels.
 *
 * Motion (motion wave, owner 2026-10-26): the chip fades in and out
 * (lh-fade reads Radix's data-state; the 500ms rest is unchanged).
 */

/** The rest delay (ms): shared by hover and focus opens. */
export const TOOLTIP_DELAY_MS = 500

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
        className={cn(
          "lh-fade z-50 w-fit rounded-md bg-accent px-2 py-1 text-[11px] text-foreground/85 text-balance",
          className
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }