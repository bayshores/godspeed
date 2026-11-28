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
		<section data-testid={testid} aria-label={title} className="flex flex-col gap-(--lh-gap)">
			{children}
		</section>
	);
}

/** A sheet inside a section ("Access", "Your agent"): its title (and a line
 *  saying what it is, when given), then its rows. */
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
		<section data-testid={testid} className="lh-sheet lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">{label}</h2>
			</div>
			{about && <p className="text-ui text-ink-2">{about}</p>}
			<div className="flex flex-col [&>p]:py-3 [&>p]:text-ui">{children}</div>
		</section>
	);
}

/** One label + one control: label left (with an optional muted hint under
 *  it), control right. A control too wide for the card drops under the text;
 *  a label with a hint asks for more room first, so its hint is never crushed. */
export function SettingsRow({
	label,
	hint,
	children,
	testid,
}: {
	label: string;
	hint?: ReactNode;
	children: React.ReactNode;
	testid?: string;
}) {
	return (
		<div data-testid={testid} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3.5">
			<span className={cn("min-w-0", hint ? "flex-[1_1_14rem]" : "flex-[1_1_7rem]")}>
				<span className="block text-item leading-snug text-ink">{label}</span>
				{hint && <span className="block pt-0.5 text-ui text-ink-2">{hint}</span>}
			</span>
			{children}
		</div>
	);
}

/** A slider: moves freely, saves when released (every save is a section
 *  PUT). `label` names the current value beside it. */
export function Slider({
	value,
	min,
	max,
	onCommit,
	label,
	ariaLabel,
	testid,
}: {
	value: number;
	min: number;
	max: number;
	onCommit: (next: number) => void;
	label: (value: number) => string;
	ariaLabel: string;
	testid?: string;
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
				value={shown}
				aria-label={ariaLabel}
				data-testid={testid}
				onChange={(e) => setDraft(Number(e.target.value))}
				onPointerUp={commit}
				onKeyUp={commit}
				onBlur={commit}
				style={{ "--fill": `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
				className="lh-press h-4 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-0.5 [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--foreground)_var(--fill),var(--lh-edge)_var(--fill))] [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-ink"
			/>
			<span className="w-[120px] shrink-0 whitespace-nowrap text-ui tabular-nums text-ink">{label(shown)}</span>
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
			className="h-10 w-[200px] lh-well lh-notch px-3 font-ui text-ui text-ink placeholder:text-ink-3"
		/>
	);
}

/** The settings' small key (a plain "Continue" or "Cancel"). */
export const SMALL_KEY = "lh-btn shrink-0";

/** A small key with no face, just a word ("Copy", "New token"). */
export const QUIET_KEY = "lh-btn lh-btn-quiet";
