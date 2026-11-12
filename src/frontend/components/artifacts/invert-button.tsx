import { SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";

/** The figure and demo cards' brightness switch: a word button, lit while on. */
export function InvertButton({
	label,
	checked,
	onToggle,
}: {
	label: string;
	checked: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			data-testid={`toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
			onClick={onToggle}
			className={cn(SMALL_BTN, checked && "bg-tone-2")}
		>
			{label}
		</button>
	);
}
