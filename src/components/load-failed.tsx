import { cn } from "@/lib/utils";

/** Shown when a page's data couldn't be read: a plain sentence and
 *  "Try again", which reads it again. */
export function LoadFailed({ message, onRetry, className }: { message: string; onRetry: () => void; className?: string }) {
	return (
		<p data-testid="load-failed" role="alert" className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-ink-2", className)}>
			{message}
			<button type="button" data-testid="load-failed-retry" onClick={onRetry} className="lh-press text-sm font-bold text-ink hover:text-ink-max">
				Try again
			</button>
		</p>
	);
}
