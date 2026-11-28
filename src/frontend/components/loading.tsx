import { useState, type ComponentProps } from "react";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { cn } from "@/frontend/lib/utils";

/** A wait while data is read, in the size of what comes: a still box with the one live element. */
export function LoadingBox({ className, ...rest }: ComponentProps<"div">) {
	return (
		<div {...rest} className={cn("flex w-full items-center justify-center text-ink-2", className)}>
			<BrailleSpinner label="Loading" className="h-4 text-current" />
		</div>
	);
}

/** The same wait where what comes has no size yet: the spinner and a word. */
export function LoadingLine({ children = "Loading…", className }: { children?: string; className?: string }) {
	return (
		<p className={cn("flex items-center gap-2 text-ink-2", className)}>
			<BrailleSpinner label={children} className="text-current" />
			<span aria-hidden>{children}</span>
		</p>
	);
}

/** True where the learner saw the wait first. What then replaces it steps in
 *  (.lh-set, .lh-block-in); what was there at first render never animates. */
export function useWaited(ready: boolean): boolean {
	const [waited] = useState(!ready);
	return waited;
}

/** `useWaited` for a list with a search field: a search changes the rows at once, so once the field
 *  has been typed in the rows no longer step in. Call `typed` from the field's onChange. */
export function useWaitedUntilTyped(ready: boolean): { stepsIn: boolean; typed: () => void } {
	const waited = useWaited(ready);
	const [searched, setSearched] = useState(false);
	return { stepsIn: waited && !searched, typed: () => setSearched(true) };
}
