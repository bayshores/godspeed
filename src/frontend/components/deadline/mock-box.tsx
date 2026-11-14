import { useId, useState, type RefObject } from "react";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Segmented } from "@/frontend/components/ui/segmented";
import { MINUTES, QUESTIONS, clampTo, type StepRange } from "./mocks-model";

const LIMITS = [
	{ value: "none", label: "No time limit" },
	{ value: "limit", label: "Time limit" },
] as const;

/**
 * THE MOCK BOX, opened from "Take a mock": how many questions, and no time
 * limit (the default) or a time limit in minutes. "Write the mock" asks the
 * teacher for the questions and opens the mock's page, which has "Start
 * the mock" once they are written. Esc or a click outside closes it.
 */
export function MockBox({
	open,
	anchorRef,
	onClose,
	onWrite,
}: {
	open: boolean;
	/** The "Take a mock" button. */
	anchorRef: RefObject<HTMLElement | null>;
	onClose: () => void;
	/** Gives back why it failed, or null (the mock's page then opens). */
	onWrite: (questions: number, minutes: number | null) => Promise<string | null>;
}) {
	useMenuDismiss(open, onClose, anchorRef);
	return (
		<MenuShell open={open} anchorRef={anchorRef} testid="mock-box" role="dialog" label="Take a mock" preferredSide="down" align="left" menuClass="lh-popup flex w-[320px] flex-col gap-4 p-5">
			<MockBoxForm onWrite={onWrite} />
		</MenuShell>
	);
}

function MockBoxForm({ onWrite }: { onWrite: (questions: number, minutes: number | null) => Promise<string | null> }) {
	const [questions, setQuestions] = useState(QUESTIONS.start);
	const [limited, setLimited] = useState(false);
	const [minutes, setMinutes] = useState(MINUTES.start);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const write = async () => {
		setBusy(true);
		setError(null);
		const failed = await onWrite(questions, limited ? minutes : null);
		// On success the mock's page opens and this box goes with the page.
		if (failed) {
			setBusy(false);
			setError(failed);
		}
	};
	return (
		<>
			<Stepper label="Questions" range={QUESTIONS} value={questions} disabled={busy} testid="mock-box-questions" onChange={setQuestions} />
			<div className="flex flex-col gap-1.5">
				<span className={LABEL_TEXT}>Time</span>
				<Segmented label="Time" testid="mock-box-time" options={LIMITS} value={limited ? "limit" : "none"} disabled={busy} onChange={(v) => setLimited(v === "limit")} />
			</div>
			{limited && <Stepper label="Minutes" range={MINUTES} value={minutes} disabled={busy} testid="mock-box-minutes" onChange={setMinutes} />}
			{error && (
				<p role="alert" data-testid="mock-box-error" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
			<button type="button" data-testid="mock-box-write" disabled={busy} onClick={() => void write()} className="lh-btn lh-btn-main h-11 w-full justify-center text-[15px]">
				{busy ? "Asking for the mock" : "Write the mock"}
			</button>
		</>
	);
}

const STEP = "lh-btn h-10 w-10 shrink-0 justify-center px-0";

/** A number with − and + beside it; it can be typed too, and stays in its range. */
function Stepper({ label, range, value, disabled, testid, onChange }: { label: string; range: StepRange; value: number; disabled: boolean; testid: string; onChange: (n: number) => void }) {
	const id = useId();
	// What is typed, kept as typed until it is left.
	const [typed, setTyped] = useState<string | null>(null);
	const step = (by: number) => onChange(clampTo(range, value + by, value));
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className={LABEL_TEXT}>
				{label}
			</label>
			<div className="flex items-center gap-2">
				<button type="button" data-testid={`${testid}-less`} aria-label={`Fewer ${label.toLowerCase()}`} disabled={disabled || value <= range.min} onClick={() => step(-range.step)} className={STEP}>
					<PixelIcon name="minus" />
				</button>
				<input
					id={id}
					type="number"
					inputMode="numeric"
					data-testid={testid}
					min={range.min}
					max={range.max}
					step={range.step}
					value={typed ?? String(value)}
					disabled={disabled}
					onChange={(e) => setTyped(e.target.value)}
					onBlur={() => {
						if (typed !== null) onChange(clampTo(range, Number.parseFloat(typed), value));
						setTyped(null);
					}}
					className="h-10 w-[72px] [appearance:textfield] rounded border-[1.5px] border-ink bg-background text-center font-count text-lg text-ink [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
				/>
				<button type="button" data-testid={`${testid}-more`} aria-label={`More ${label.toLowerCase()}`} disabled={disabled || value >= range.max} onClick={() => step(range.step)} className={STEP}>
					<PixelIcon name="plus" />
				</button>
			</div>
		</div>
	);
}
