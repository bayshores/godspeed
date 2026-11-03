import { cn } from "@/lib/utils";

/** A row of choices, one picked (the setup's Written, the rail's Text
 *  size, Columns and Ink). `wide` stretches it to its column. */
export function Segmented<T extends string | number>({
	label,
	value,
	options,
	onPick,
	wide = false,
	disabled = false,
}: {
	label: string;
	value: T;
	options: readonly { id: T; label: string }[];
	onPick: (id: T) => void;
	wide?: boolean;
	disabled?: boolean;
}) {
	return (
		<div role="radiogroup" aria-label={label} className={cn("flex gap-[3px] bg-background p-[3px] outline outline-1 -outline-offset-1 outline-tone-2", wide && "w-full")}>
			{options.map((o) => {
				const on = o.id === value;
				return (
					<button
						key={String(o.id)}
						type="button"
						role="radio"
						aria-checked={on}
						disabled={disabled}
						onClick={() => onPick(o.id)}
						className={cn(
							"lh-press px-3.5 py-[6px] text-[13.5px] disabled:opacity-60",
							wide && "flex-1",
							on ? "bg-tone-2 font-bold text-ink" : "text-ink-2 hover:text-ink",
						)}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
