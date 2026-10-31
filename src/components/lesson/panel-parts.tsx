import { cn } from "@/lib/utils";

/**
 * The Your-turn panel's shared pieces: every
 * state of the right panel — a waiting question, a practice problem, the
 * message box — is a padded content column over a full-width action bar.
 */

/** The scrollable content column above the action bar. */
export function PanelBody({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 pb-5", className)}>{children}</div>
	);
}

/** "Your turn" (or "Teacher is writing…") with an optional chip right. */
export function PanelHeader({ eyebrow, right }: { eyebrow: React.ReactNode; right?: React.ReactNode }) {
	return (
		<div className="flex shrink-0 items-center justify-between gap-3">
			<div data-testid="panel-eyebrow" className="text-[13px] font-bold text-ink-3">
				{eyebrow}
			</div>
			{right}
		</div>
	);
}

/** A small tone button in the header (Stop, Skip question, Discard problem). */
export function PanelHeaderButton({ children, onClick, testId }: { children: React.ReactNode; onClick: () => void; testId: string }) {
	return (
		<button
			type="button"
			data-testid={testId}
			onClick={onClick}
			className="lh-press lh-fade flex shrink-0 items-center gap-1.5 bg-tone px-2 py-[3px] text-[12.5px] font-bold text-ink-2 hover:text-ink"
		>
			{children}
		</button>
	);
}

/** The header's right side: an optional way out (Skip question, Discard
 *  problem), then the chip. */
export function HeaderChip({ exit, children }: { exit?: { label: string; testId: string; onClick: () => void }; children: React.ReactNode }) {
	return (
		<div className="flex shrink-0 items-center gap-2">
			{exit && (
				<PanelHeaderButton testId={exit.testId} onClick={exit.onClick}>
					{exit.label}
				</PanelHeaderButton>
			)}
			{children}
		</div>
	);
}

/** Skip question, for a waiting question's header. */
export function skipExit(onSkip: (() => void) | undefined) {
	return onSkip && { label: "Skip question", testId: "skip-question", onClick: onSkip };
}

/** The small tone chip in the header (question kind, problem number). */
export function KindChip({ children, testId }: { children: React.ReactNode; testId?: string }) {
	return (
		<span data-testid={testId} className="flex shrink-0 items-center gap-1.5 bg-tone px-2 py-[3px] text-[13px] font-extrabold text-ink">
			{children}
		</span>
	);
}

/** A field's bold label ("Your thinking"). */
export function FieldLabel({ children }: { children: React.ReactNode }) {
	return <div className="shrink-0 pb-2 text-sm font-bold text-ink-2">{children}</div>;
}

/** The black writing field that fills the rest of the column. */
export const PANEL_FIELD =
	"lh-input min-h-28 w-full flex-1 resize-none bg-background px-3.5 py-3 text-[15px]! leading-[22px]! text-ink outline-none placeholder:text-ink-3";

/** The panel fields' keys: Esc stays in the field (it must not abort the
 *  turn); Enter submits, Shift+Enter is a newline, ⌘/Ctrl+Enter submits. */
export function fieldKeys(e: React.KeyboardEvent<HTMLTextAreaElement>, submit: () => void) {
	if (e.key === "Escape") {
		e.preventDefault();
		e.stopPropagation();
		return;
	}
	if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
		e.preventDefault();
		submit();
	}
}

/** The full-width action bar at the panel's foot: white for the main
 *  action, gray while it waits ("Send when ready"). */
export function ActionBar({
	label,
	onClick,
	disabled,
	waiting = false,
	testId,
	type = "button",
}: {
	label: React.ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	waiting?: boolean;
	testId?: string;
	type?: "button" | "submit";
}) {
	return (
		<button
			type={type}
			data-testid={testId}
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"lh-press flex h-14 w-full shrink-0 items-center px-6 text-left text-base font-extrabold transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
				waiting ? "bg-tone-2 text-ink" : "bg-ink text-background hover:bg-ink-max",
				"disabled:cursor-default disabled:opacity-50 disabled:hover:bg-ink",
				waiting && "disabled:hover:bg-tone-2",
			)}
		>
			<span>{label}</span>
		</button>
	);
}
