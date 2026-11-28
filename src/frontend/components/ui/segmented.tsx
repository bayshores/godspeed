import { useRef } from "react";
import { useLitMarker } from "@/frontend/components/lit-marker";
import { cn } from "@/frontend/lib/utils";

/** One pick out of a few, as joined buttons; the picked one is filled. The fill is one box that
 *  slides to a new pick (useLitMarker), and each word changes its color with it. */
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
	const rowRef = useRef<HTMLDivElement>(null);
	const fill = useLitMarker(rowRef, '[aria-checked="true"]', value);
	return (
		<div ref={rowRef} role="radiogroup" aria-label={label} className="relative isolate flex shrink-0 self-start lh-well overflow-hidden lh-notch">
			<div ref={fill} hidden aria-hidden className="lh-lit-marker bg-tint" />
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="radio"
					aria-checked={value === o.value}
					data-testid={`${testid}-${o.value}`}
					disabled={disabled}
					onClick={() => onChange(o.value)}
					className={cn(
						"px-3.5 py-2 text-ui leading-tight transition-colors duration-(--lh-dur-slow) ease-(--lh-ease-out)",
						value === o.value ? "text-background" : "text-ink hover:bg-tone",
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
