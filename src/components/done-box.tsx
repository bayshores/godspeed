import { cn } from "@/lib/utils";

/**
 * A deadline's done box (sidebar Due soon, Home): an empty square with a
 * red border once the deadline is overdue. Clicking it ticks the deadline
 * done.
 */
export function DoneBox({
	size,
	overdue,
	name,
	disabled,
	onDone,
}: {
	/** Side in px (13 in the sidebar, 16 on Home). */
	size: number;
	overdue: boolean;
	/** The deadline's name, for the label. */
	name: string;
	disabled?: boolean;
	onDone: () => void;
}) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={false}
			aria-label={`Mark ${name} done`}
			data-testid="done-box"
			data-overdue={overdue || undefined}
			disabled={disabled}
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onDone();
			}}
			className={cn(
				// An inset outline, not a border: the app's global border color
				// would win over a border utility.
				"lh-press shrink-0 bg-transparent outline outline-[1.5px] -outline-offset-[1.5px] disabled:opacity-60",
				overdue ? "outline-ans-wrong hover:bg-ans-wrong/20" : "outline-ink-3 hover:outline-ink",
			)}
			style={{ width: size, height: size }}
		/>
	);
}
