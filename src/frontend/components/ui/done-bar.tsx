import { cn } from "@/frontend/lib/utils";

/** A bar shows at most this many blocks; more problems scale into them. */
const MAX_BLOCKS = 10;

/** How many problems are done, as blocks: one per problem (scaled to ten
 *  past ten), done ones in ink. Homework and projects show it where exams
 *  show the ready bar. */
export function DoneBar({ done, total, className, blockClassName = "h-2.5 w-[7px]" }: { done: number; total: number; className?: string; blockClassName?: string }) {
	const blocks = Math.min(total, MAX_BLOCKS);
	const filled = total <= MAX_BLOCKS ? done : Math.round((done / total) * MAX_BLOCKS);
	return (
		<span data-testid="done-bar" role="img" aria-label={`${done} of ${total} problems done`} className={cn("flex gap-0.5", className)}>
			{Array.from({ length: blocks }, (_, i) => (
				<span key={i} className={blockClassName} style={{ background: i < filled ? "var(--color-ink)" : "var(--border)" }} />
			))}
		</span>
	);
}
