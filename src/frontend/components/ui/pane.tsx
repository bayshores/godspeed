import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/frontend/lib/utils";

/**
 * A sheet: a block of paper on its lip, the app's one container.
 */
export function Pane({ className, children, ...rest }: { children: ReactNode; ref?: Ref<HTMLElement> } & HTMLAttributes<HTMLElement>) {
	return (
		<section {...rest} className={cn("relative lh-sheet", className)}>
			{children}
		</section>
	);
}
