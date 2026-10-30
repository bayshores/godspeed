import * as React from "react"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

/**
 * An icon or pill control's label, shown as the tooltip's white tag. No
 * shortcut in it: godspeed's learners use the mouse.
 *
 * children must be a single element able to take a ref (TooltipTrigger
 * asChild merges onto it — no wrapper DOM, no layout shift).
 */

interface HintProps {
	label: string
	side?: "top" | "bottom" | "left" | "right"
	children: React.ReactElement
}

export function Hint({ label, side = "top", children }: HintProps) {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>{children}</TooltipTrigger>
				<TooltipContent side={side} tag>
					{label}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}
