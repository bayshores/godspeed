import type { ComponentProps } from "react";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { cn } from "@/frontend/lib/utils";

/**
 * The app's key (.lh-btn); `className` adds its look (lh-btn-main, a
 * size). While the request it started runs (`busy`) it keeps full opacity
 * and its size: the label stays in place, clear, and the spinner sits over
 * the key's face (clear of a tile's shadow and a plate's lip).
 */
export function Key({
	className,
	busy = false,
	disabled,
	children,
	type = "button",
	...props
}: ComponentProps<"button"> & {
	/** The request this key started is running. */
	busy?: boolean;
}) {
	return (
		<button type={type} {...props} disabled={disabled || busy} aria-busy={busy || undefined} className={cn("lh-btn", busy && "relative disabled:opacity-100", className)}>
			{busy ? (
				<>
					<span className="contents text-transparent">{children}</span>
					<span className="pointer-events-none absolute inset-0 flex items-center justify-center pr-(--lh-drop) pb-[calc(var(--lh-drop)+var(--lh-lip))]">
						<BrailleSpinner className="h-4 text-current" />
					</span>
				</>
			) : (
				children
			)}
		</button>
	);
}
