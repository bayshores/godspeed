/**
 * Thin settings primitives: the control kit the settings dialog
 * needs. Sections → groups → rows; everything SSRs clean (render tests
 * pin the sections' markup).
 *
 * Dependency graying: the WHOLE row dims (label and control together) and
 * the control itself locks; the row owns the dim.
 */

import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";
import { RULE } from "@/frontend/components/deadline/styles";

/** A section block: the page's tab names the section, so the block is
 *  just its groups. */
export function SettingsSection({
	title,
	children,
	testid,
}: {
	title: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<section data-testid={testid} aria-label={title} className="flex flex-col gap-6">
			{children}
		</section>
	);
}

/** A sheet inside a section ("Access", "Your agent"): its title (and a line
 *  saying what it is, when given) over an ink rule, then its rows with a
 *  dotted line between them. */
export function SettingsGroup({
	label,
	about,
	children,
	testid,
}: {
	label: string;
	about?: string;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<section data-testid={testid} className="rounded border-2 border-line bg-panel px-6 pt-4 pb-1.5">
			<h2 className={cn("text-xl leading-tight text-ink", about ? "pb-0.5" : "pb-2")}>{label}</h2>
			{about && <p className="pb-2 text-[15px] text-ink-2">{about}</p>}
			<div className={RULE} />
			<div className="flex flex-col divide-y divide-dotted divide-edge [&>p]:py-2.5 [&>p]:text-base">{children}</div>
		</section>
	);
}

/** One label + one control: label left (with an optional muted hint under
 *  it), control right. */
export function SettingsRow({
	label,
	hint,
	children,
	testid,
	dimmed,
}: {
	label: string;
	hint?: ReactNode;
	children: React.ReactNode;
	testid?: string;
	/** Dependency graying: the whole row dims when the
	 *  control is inert (parent off, no file yet, …). */
	dimmed?: boolean;
}) {
	return (
		<div data-testid={testid} className={cn("flex items-center justify-between gap-4 py-2", dimmed && "opacity-40")}>
			<span className="min-w-0">
				<span className="block text-lg font-medium text-ink">{label}</span>
				{hint && <span className="block text-base text-ink-2">{hint}</span>}
			</span>
			{children}
		</div>
	);
}

/** The on/off switch: a plain button in the switch role, its state in words
 *  beside a small track. */
export function Toggle({
	checked,
	disabled,
	onChange,
	label,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (next: boolean) => void;
	/** Accessible name for the switch role. */
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			data-testid={`toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
			onClick={() => onChange(!checked)}
			className={cn("lh-press group flex shrink-0 items-center gap-2", disabled && "cursor-not-allowed")}
		>
			<span className="text-base font-medium text-ink">{checked ? "On" : "Off"}</span>
			<span
				className={cn(
					"relative h-[22px] w-10 rounded-[3px]",
					// On is a filled track with the knob at the right; off is an
					// empty track (a 3:1 edge) with the knob at the left.
					checked ? "bg-ink" : "shadow-[inset_0_0_0_1.5px_var(--lh-edge)] group-enabled:group-hover:shadow-[inset_0_0_0_1.5px_var(--lh-ink-3)]",
				)}
			>
				<span
					className={cn(
						"absolute left-0 top-[3px] size-4 rounded-sm transition-[translate,background-color] duration-(--lh-dur) ease-(--lh-ease-out) motion-reduce:transition-none",
						checked ? "translate-x-[21px] bg-background" : "translate-x-[3px] bg-ink-2",
					)}
				/>
			</span>
		</button>
	);
}

/** A slider: moves freely, saves when released (every save is a section
 *  PUT). `label` names the current value beside it. */
export function Slider({
	value,
	min,
	max,
	step = 1,
	onCommit,
	label,
	ariaLabel,
	testid,
	disabled,
}: {
	value: number;
	min: number;
	max: number;
	step?: number;
	onCommit: (next: number) => void;
	label: (value: number) => string;
	ariaLabel: string;
	testid?: string;
	disabled?: boolean;
}) {
	const [draft, setDraft] = useState<number | null>(null);
	// The draft stays shown until the saved value comes back, so a second
	// drag or key press starts from it, not from the old value.
	const [saved, setSaved] = useState(value);
	if (value !== saved) {
		setSaved(value);
		setDraft(null);
	}
	const shown = draft ?? value;
	const commit = () => {
		if (draft === null) return;
		if (draft === value) setDraft(null);
		else onCommit(draft);
	};
	return (
		<span className="flex w-full items-center gap-3.5">
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={shown}
				disabled={disabled}
				aria-label={ariaLabel}
				data-testid={testid}
				onChange={(e) => setDraft(Number(e.target.value))}
				onPointerUp={commit}
				onKeyUp={commit}
				onBlur={commit}
				style={{ "--fill": `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
				className="lh-press h-4 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--foreground)_var(--fill),var(--lh-edge)_var(--fill))] [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-xs [&::-webkit-slider-thumb]:bg-ink"
			/>
			<span className="w-[120px] shrink-0 whitespace-nowrap text-[15px] tabular-nums text-ink">{label(shown)}</span>
		</span>
	);
}

/** A thin text input committing on blur + Enter (settings pace, not
 *  typing pace — every commit is a section PUT). */
export function CommitInput({
	value,
	placeholder,
	onCommit,
	ariaLabel,
	testid,
}: {
	/** "" = unset (the factory default). Mirrors the STORED record, so
	 *  after a clamped commit the field shows what was really saved. */
	value: string;
	placeholder?: string;
	onCommit: (next: string) => void;
	ariaLabel: string;
	testid?: string;
}) {
	// The draft exists only while editing; a blur shows the record's value
	// again, so the field is honest about what landed.
	const [draft, setDraft] = useState(value);
	const [editing, setEditing] = useState(false);
	const cancelled = useRef(false);
	return (
		<input
			type="text"
			value={editing ? draft : value}
			placeholder={placeholder}
			aria-label={ariaLabel}
			data-testid={testid}
			onChange={(e) => {
				setEditing(true);
				setDraft(e.target.value);
			}}
			onBlur={() => {
				if (!editing) return;
				setEditing(false);
				if (cancelled.current) {
					cancelled.current = false;
					return;
				}
				const next = draft.trim();
				if (next !== value) onCommit(next);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				if (e.key === "Escape" && editing) {
					// An edit only cancels: the dialog skips a prevented Escape.
					e.preventDefault();
					e.stopPropagation();
					cancelled.current = true;
					setEditing(false);
					e.currentTarget.blur();
				}
			}}
			className="h-[38px] w-[200px] rounded border-[1.5px] border-ink bg-background px-3 font-ui text-[15px] text-ink placeholder:text-ink-3"
		/>
	);
}

/** The settings' small key (a plain "Continue" or "Cancel"). */
export const SMALL_KEY = "lh-btn shrink-0 text-[15px]";

/** A small key with no face, just a word ("Copy", "New token"). */
export const QUIET_KEY = "lh-btn lh-btn-quiet text-[15px]";
