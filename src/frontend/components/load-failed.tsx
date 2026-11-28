import { cn } from "@/frontend/lib/utils";

/** Shown when a page's data couldn't be read: a plain sentence and
 *  "Try again", which reads it again. */
export function LoadFailed({ message, onRetry, className }: { message: string; onRetry: () => void; className?: string }) {
	return (
		<div data-testid="load-failed" role="alert" className={cn("lh-rise flex flex-col items-center gap-3.5 py-[60px] text-center", className)}>
			<p className="text-head leading-snug text-ink">{message}</p>
			<button type="button" data-testid="load-failed-retry" onClick={onRetry} className="lh-btn">
				Try again
			</button>
		</div>
	);
}
