import { cn } from "@/lib/utils";

/** The small on/off switch beside a short label (Halley's Follow, the code
 *  editor's Vim). */
export function SmallSwitch({
	on,
	onChange,
	label,
	testId,
}: {
	on: boolean;
	onChange: (next: boolean) => void;
	label: string;
	testId?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			data-testid={testId}
			onClick={() => onChange(!on)}
			className={cn("lh-press relative h-4 w-7 shrink-0", on ? "bg-ink" : "bg-tone-2")}
		>
			<span
				className={cn(
					"absolute top-[3px] left-[3px] size-2.5 transition-transform duration-(--lh-dur) ease-(--lh-ease-out) motion-reduce:transition-none",
					on ? "translate-x-3 bg-background" : "translate-x-0 bg-ink-2",
				)}
			/>
		</button>
	);
}
