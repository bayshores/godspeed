import { cn } from "@/frontend/lib/utils";

/**
 * How far something is: ink over a dotted track. Decorative: the line
 * beside it says the same in words.
 */
export function ProgressBar({ share, className }: { share: number; className?: string }) {
	return (
		<span aria-hidden className={cn("relative block h-3.5", className)}>
			<span className="absolute inset-x-0 top-[3px] h-2 bg-[radial-gradient(var(--color-ink-2)_1px,transparent_1px)] bg-[length:4px_4px]" />
			<span className="lh-grow absolute inset-y-0 left-0 bg-ink" style={{ width: `${Math.min(1, Math.max(0, share)) * 100}%` }} />
		</span>
	);
}
