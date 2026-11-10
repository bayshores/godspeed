import { SquareIcon } from "lucide-react";
import { cn } from "@/frontend/lib/utils";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/**
 * The Your-turn panel's shared pieces: every state of the right panel (a
 * waiting question, a practice problem, the message box) is a padded
 * content column; a writing box carries its own Send.
 */

/** The panel's scrollable content column; scrolled text fades out inside
 *  its padding instead of running into the pane's border. */
export function PanelBody({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<div className={cn("lh-edge-fade flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 pb-5", className)}>{children}</div>
	);
}

/** The status while a turn runs ("<teacher> is writing…") with an
 *  optional chip right; nothing when the learner's turn has neither. */
export function PanelHeader({ status, right }: { status?: React.ReactNode; right?: React.ReactNode }) {
	if (!status && !right) return null;
	return (
		<div className="flex shrink-0 items-center justify-between gap-3">
			<div data-testid="panel-status" className={LABEL_TEXT}>
				{status}
			</div>
			{right}
		</div>
	);
}

/** A quiet text button in a panel's header (Stop, Discard problem). */
function ToneButton({ children, onClick, testId, disabled }: { children: React.ReactNode; onClick: () => void; testId: string; disabled?: boolean }) {
	return (
		<button
			type="button"
			data-testid={testId}
			onClick={onClick}
			disabled={disabled}
			className="lh-press lh-fade flex shrink-0 items-center gap-1.5 px-2 py-1 text-[15px] text-ink-2 hover:bg-tone hover:text-ink disabled:cursor-default disabled:text-ink-3 disabled:hover:bg-transparent"
		>
			{children}
		</button>
	);
}

/** Stops the running turn (Esc does too). */
export function StopButton({ onStop }: { onStop: () => void }) {
	return (
		<ToneButton testId="stop-turn" onClick={onStop}>
			<SquareIcon aria-hidden className="size-3" />
			Stop
		</ToneButton>
	);
}

/** The header's right side: an optional way out (Skip question, Discard
 *  problem), then the chip. */
export function HeaderChip({ exit, children }: { exit?: { label: string; testId: string; onClick: () => void }; children: React.ReactNode }) {
	return (
		<div className="flex shrink-0 items-center gap-2">
			{exit && (
				<ToneButton testId={exit.testId} onClick={exit.onClick}>
					{exit.label}
				</ToneButton>
			)}
			{children}
		</div>
	);
}

/** Skip question, for a waiting question's header. */
export function skipExit(onSkip: (() => void) | undefined) {
	return onSkip && { label: "Skip question", testId: "skip-question", onClick: onSkip };
}

/** The header's plain kind label (question kind, problem number): text,
 *  not a box, so it never reads as a button beside Skip question. */
export function KindChip({ children, testId }: { children: React.ReactNode; testId?: string }) {
	return (
		<span data-testid={testId} className={cn("flex shrink-0 items-center gap-1.5", LABEL_TEXT)}>
			{children}
		</span>
	);
}

/** A writing field's look: black with a visible edge, so it reads as a
 *  page rather than another row of the panel. The edge brightens while
 *  the field has focus. */
export const FIELD_EDGE = "border border-tone-2 focus-within:border-ink-2 bg-background text-[16px]! leading-6! text-ink";

/** The send button inside a writing box's bottom edge: filled, outlined
 *  while it waits ("Send when ready"). */
export function SendButton({
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
			className={cn("lh-btn ml-auto shrink-0", !waiting && "lh-btn-main")}
		>
			{label}
		</button>
	);
}

/** The full-width action bar at the panel's foot, for a panel whose one
 *  action is not sending a box (Skip question, Check your understanding). */
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
				waiting ? "bg-tone-2 text-ink" : "bg-tint text-background hover:bg-[color-mix(in_oklab,var(--lh-tint)_82%,white)]",
				"disabled:cursor-default disabled:opacity-50 disabled:hover:bg-tint",
				waiting && "disabled:hover:bg-tone-2",
			)}
		>
			<span>{label}</span>
		</button>
	);
}
