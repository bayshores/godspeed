import { cn } from "@/frontend/lib/utils";

/** The send button inside a writing box's bottom edge: filled, outlined
 *  while it waits. */
export function SendButton({
	label,
	onClick,
	disabled,
	waiting = false,
	testId,
}: {
	label: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	waiting?: boolean;
	testId: string;
}) {
	return (
		<button type="button" data-testid={testId} onClick={onClick} disabled={disabled} className={cn("lh-btn ml-auto shrink-0", !waiting && "lh-btn-main")}>
			{label}
		</button>
	);
}
