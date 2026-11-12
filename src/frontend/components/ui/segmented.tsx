import { cn } from "@/frontend/lib/utils";

/** One pick out of a few, as joined buttons; the picked one is filled. */
export function Segmented<T extends string>({
	label,
	testid,
	options,
	value,
	disabled,
	onChange,
}: {
	/** What the group picks, for screen readers. */
	label: string;
	/** Each button's test id is `${testid}-${value}`. */
	testid: string;
	options: readonly { value: T; label: string }[];
	value: T;
	disabled: boolean;
	onChange: (value: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="flex shrink-0 self-start overflow-hidden rounded border-[1.5px] border-ink">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="radio"
					aria-checked={value === o.value}
					data-testid={`${testid}-${o.value}`}
					disabled={disabled}
					onClick={() => onChange(o.value)}
					className={cn("px-3.5 py-2 text-[15px] leading-tight", value === o.value ? "bg-tint text-background" : "text-ink hover:bg-tone")}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
