import { cn } from "@/frontend/lib/utils";

/** The on/off switch: a plain button in the switch role, a word beside a small track. The word is its state (On, Off),
 *  or with `showLabel` its label, for a switch in a tight row with no label of its own (the code editor's Vim). */
export function Toggle({
	checked,
	onChange,
	label,
	showLabel = false,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	/** Accessible name for the switch role. */
	label: string;
	showLabel?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			data-testid={`toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
			onClick={() => onChange(!checked)}
			className="lh-press group flex shrink-0 items-center gap-2"
		>
			<span className="text-ui font-medium text-ink">{showLabel ? label : checked ? "On" : "Off"}</span>
			<span
				className={cn(
					"relative h-[22px] w-10 lh-notch transition-[background-color,box-shadow] duration-(--lh-dur) ease-(--lh-ease-out)",
					// On is a filled track with the knob at the right; off is an
					// empty track (a 3:1 edge) with the knob at the left.
					checked ? "bg-ink" : "shadow-[inset_0_0_0_2px_var(--lh-edge)] group-hover:shadow-[inset_0_0_0_2px_var(--lh-ink-3)]",
				)}
			>
				<span
					className={cn(
						"absolute left-0 top-[3px] size-4 lh-notch transition-[translate,background-color] duration-(--lh-dur) ease-(--lh-ease-out)",
						checked ? "translate-x-[21px] bg-background" : "translate-x-[3px] bg-ink-2",
					)}
				/>
			</span>
		</button>
	);
}
