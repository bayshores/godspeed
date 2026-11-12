import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

/**
 * A row to tick: the box, its label and a note at the right. With `radio`
 * (the group's name) it is one pick out of several.
 */
export function CheckRow({
	testid,
	label,
	note,
	checked,
	disabled,
	radio,
	onToggle,
}: {
	testid?: string;
	label: string;
	note?: string;
	checked: boolean;
	disabled: boolean;
	radio?: string;
	onToggle: () => void;
}) {
	return (
		<label className="flex shrink-0 cursor-pointer items-center gap-2.5 py-1.5">
			<input type={radio ? "radio" : "checkbox"} name={radio} data-testid={testid} checked={checked} disabled={disabled} onChange={onToggle} className="peer sr-only" />
			<span
				aria-hidden
				className={cn(
					"flex size-5 shrink-0 items-center justify-center rounded-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
					checked ? "bg-tint text-background" : "border-[1.5px] border-ink bg-background",
				)}
			>
				{checked && <PixelIcon name="check" className="h-[9px]" />}
			</span>
			<span title={label} className="min-w-0 flex-1 truncate text-[15px] text-ink">
				{label}
			</span>
			{note && <span className="shrink-0 text-base text-ink-2">{note}</span>}
		</label>
	);
}
