import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

/** What a check box holds: a tick, a half (some of a group), a cross (a day that couldn't be read), or nothing. */
type BoxMark = "tick" | "half" | "cross" | null;
const ICON = { tick: "check", half: "minus", cross: "close" } as const;

/** The drawn check box. Only the look: the control around it is the page's own. A real input just before it
 *  (`peer`) rings it while the input has keyboard focus; `className` may give a filled box another color. */
export function CheckBox({ mark, className }: { mark: BoxMark; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex size-5 shrink-0 items-center justify-center lh-notch peer-focus-visible:[clip-path:none] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
				mark ? "bg-tint text-background" : "border-2 border-ink bg-background",
				className,
			)}
		>
			{mark && <PixelIcon name={ICON[mark]} size={10} />}
		</span>
	);
}

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
			<CheckBox mark={checked ? "tick" : null} />
			<span title={label} className="min-w-0 flex-1 truncate text-ui text-ink">
				{label}
			</span>
			{note && <span className="shrink-0 text-ui text-ink-2">{note}</span>}
		</label>
	);
}
