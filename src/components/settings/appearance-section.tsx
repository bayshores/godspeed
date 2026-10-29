/**
 * Settings → Appearance (docs/design/godspeed-redesign.pen, board 11 F):
 * background presets on top, the type controls on the left and a live
 * lesson preview on the right. The preview uses the real lesson styles,
 * so every saved change shows in it (and in the app behind the dialog).
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, PipetteIcon, PlusIcon } from "lucide-react";
import type { AppearanceSettings } from "@/core";
import { MenuShell } from "@/components/menu-shell";
import { cn } from "@/lib/utils";
import { useAppearance } from "./appearance.tsx";
import { BACKGROUND_PRESETS, HEADING_WEIGHTS, INK_PRESETS, derivedPalette, isLight } from "./appearance-model.ts";
import { FontMenuList } from "./font-menu";
import { SettingsGroup, Slider, Toggle } from "./controls.tsx";

/** The factory reading family (unset = this). */
export const DEFAULT_READING_FONT = "Source Sans 3";

/** Offered when the installed list can't be read (a plain browser). */
export const CURATED_FALLBACK_FONTS: readonly string[] = [
	"Arial",
	"CMU Serif",
	"Courier New",
	"Georgia",
	"Helvetica",
	"Helvetica Neue",
	"Menlo",
	"Times New Roman",
	"Trebuchet MS",
	"Verdana",
];

/** null or blank = the factory font; otherwise the family, trimmed. */
export function composeFontFamily(appearance: AppearanceSettings | undefined, family: string | null): AppearanceSettings {
	const value = family?.trim() ?? "";
	return { ...appearance, fontFamily: value === "" ? null : value };
}

export function AppearanceSection({
	appearance,
	onSectionChange,
}: {
	/** The record's appearance delta (absent = factory). */
	appearance: AppearanceSettings | undefined;
	/** PUT the whole appearance section; the provider re-applies on success. */
	onSectionChange: (next: AppearanceSettings) => void;
}) {
	const { appearance: resolved } = useAppearance();
	const md = appearance?.mdRendering;
	const background = appearance?.background ?? null;
	const shownBackground = background ?? "#000000";
	const light = isLight(shownBackground);
	const isPreset = BACKGROUND_PRESETS.some((p) => p.color === background);
	const weightIndex = Math.max(0, HEADING_WEIGHTS.findIndex((w) => w.weight >= resolved.mdRendering.headingWeight));
	const ink = md?.boldColor ?? null;
	const inks: readonly string[] = INK_PRESETS[light ? "light" : "dark"];
	const customInk = ink !== null && !inks.includes(ink);
	const setInk = (color: string | null) =>
		onSectionChange({ ...appearance, mdRendering: { ...md, boldColor: color, italicColor: color } });

	return (
		<>
			<SettingsGroup label="Background" testid="group-background">
				<div className="grid grid-cols-7 gap-2.5">
					{BACKGROUND_PRESETS.map((preset) => (
						<ThemeTile
							key={preset.name}
							name={preset.name}
							color={preset.color ?? "#000000"}
							on={preset.color === background}
							onPick={() => onSectionChange({ ...appearance, background: preset.color })}
						/>
					))}
					<label className="lh-press flex cursor-pointer flex-col gap-[7px]" data-testid="theme-custom">
						<span
							className={cn(
								"relative flex h-16 items-center justify-center border",
								!isPreset ? "border-2 border-ink" : "border-tone-2",
							)}
							style={{
								background: !isPreset && background ? background : "conic-gradient(#e4573f, #d2a24c, #93b08a, #4a6fd1, #e4573f)",
							}}
						>
							<span className="flex size-[26px] items-center justify-center bg-background text-ink">
								<PlusIcon className="size-3.5" aria-hidden />
							</span>
							<ColorInput label="Custom background color" value={shownBackground} onCommit={(c) => onSectionChange({ ...appearance, background: c })} />
						</span>
						<span className={cn("text-[12.5px]", !isPreset ? "font-bold text-ink" : "text-ink-2")}>Custom</span>
					</label>
				</div>
			</SettingsGroup>

			<div className="mt-[22px] flex gap-6">
				<div className="flex w-[300px] shrink-0 flex-col gap-[18px]">
					<Control label="Reading font">
						<FontPicker
							family={appearance?.fontFamily ?? null}
							onPick={(family) => onSectionChange(composeFontFamily(appearance, family))}
						/>
					</Control>
					<Control label="Text size">
						<Slider
							value={resolved.proseFontSize}
							min={12}
							max={24}
							ariaLabel="Text size"
							testid="slider-text-size"
							label={(v) => `${v} px`}
							onCommit={(v) => onSectionChange({ ...appearance, proseFontSize: v })}
						/>
					</Control>
					<Control label="Heading weight">
						<Slider
							value={weightIndex}
							min={0}
							max={HEADING_WEIGHTS.length - 1}
							ariaLabel="Heading weight"
							testid="slider-heading-weight"
							label={(i) => HEADING_WEIGHTS[i]?.name ?? ""}
							onCommit={(i) => onSectionChange({ ...appearance, mdRendering: { ...md, headingWeight: HEADING_WEIGHTS[i]?.weight } })}
						/>
					</Control>
					<Control label="Bold and italic color">
						<div className="flex items-center gap-1.5">
							<InkSwatch color={derivedPalette(shownBackground)["--foreground"]!} label="Same as text" on={ink === null} onPick={() => setInk(null)} />
							{inks.map((c) => (
								<InkSwatch key={c} color={c} label={c} on={ink === c} onPick={() => setInk(c)} />
							))}
							<label
								className={cn(
									"lh-press relative flex size-7 cursor-pointer items-center justify-center border text-ink-2 hover:text-ink",
									customInk ? "border-2 border-ink" : "border-tone-2",
								)}
								style={customInk ? { background: ink } : undefined}
							>
								<PipetteIcon className="size-[13px]" aria-hidden />
								<ColorInput label="Custom bold and italic color" value={ink ?? "#ffffff"} onCommit={setInk} />
							</label>
						</div>
					</Control>
					<Control label="Lesson titles">
						<div className="flex items-center justify-between bg-tone px-3 py-2">
							<span className="text-[13.5px] text-ink">Serif titles</span>
							<Toggle
								checked={resolved.sessionNameSerif}
								label="serif titles"
								onChange={(on) => onSectionChange({ ...appearance, sessionNameSerif: on })}
							/>
						</div>
					</Control>
				</div>
				<Preview />
			</div>
		</>
	);
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<p className="text-[13px] font-bold text-ink-3">{label}</p>
			{children}
		</div>
	);
}

function ThemeTile({ name, color, on, onPick }: { name: string; color: string; on: boolean; onPick: () => void }) {
	const p = derivedPalette(color);
	return (
		<button type="button" aria-pressed={on} data-testid={`theme-${name.toLowerCase()}`} onClick={onPick} className="lh-press flex flex-col gap-[7px] text-left">
			<span
				className={cn("flex h-16 flex-col gap-[5px] px-2.5 py-2.5", on ? "border-2 border-ink" : "border")}
				style={{ background: color, borderColor: on ? undefined : p["--border"] }}
			>
				<span className="h-1.5 w-11" style={{ background: p["--foreground"] }} />
				<span className="h-1 w-full" style={{ background: p["--muted-foreground"] }} />
				<span className="h-1 w-[30px]" style={{ background: p["--muted-foreground"] }} />
			</span>
			<span className={cn("text-[12.5px]", on ? "font-bold text-ink" : "text-ink-2")}>{name}</span>
		</button>
	);
}

/** The system color picker, invisible over its tile. Saves once the pick
 *  is done (the native change event), not on every drag step. */
function ColorInput({ label, value, onCommit }: { label: string; value: string; onCommit: (color: string) => void }) {
	return (
		<input
			type="color"
			aria-label={label}
			defaultValue={value}
			ref={(el) => {
				if (el) el.onchange = () => onCommit(el.value);
			}}
			className="absolute inset-0 cursor-pointer opacity-0"
		/>
	);
}

function InkSwatch({ color, label, on, onPick }: { color: string; label: string; on: boolean; onPick: () => void }) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={on}
			onClick={onPick}
			className={cn("lh-press size-7", on ? "outline-2 outline-offset-2 outline-ink" : "")}
			style={{ background: color, outlineStyle: on ? "solid" : undefined }}
		/>
	);
}

/** The sample lesson, drawn with the real lesson styles. */
function Preview() {
	return (
		<div className="min-w-0 flex-1 self-start border border-tone-2 bg-background px-5 py-[18px]" data-testid="appearance-preview">
			<p className="pb-2 text-[11.5px] font-bold text-ink-3">Preview</p>
			<h4 className="font-title pb-2 text-[22px] leading-tight text-ink">Why a derivative is a slope</h4>
			<div className="lh-prose flex flex-col gap-2.5">
				<p>
					Zoom in on a smooth curve and it <strong>looks straight</strong>.
				</p>
				<p>
					That line&apos;s slope <em>is</em> the derivative at the point.
				</p>
				<h4 className="text-[1.1em]">Picking the line</h4>
				<p>Take two points and slide one toward the other.</p>
			</div>
		</div>
	);
}

/** The reading-font menu trigger. The installed families load on the
 *  first open (desktop app); a plain browser gets a short common list. */
function FontPicker({ family, onPick }: { family: string | null; onPick: (family: string | null) => void }) {
	const [open, setOpen] = useState(false);
	const [fonts, setFonts] = useState<string[] | null | undefined>(undefined);
	const anchorRef = useRef<HTMLSpanElement>(null);

	const toggle = () => {
		if (!open && fonts === undefined) {
			const list = typeof window === "undefined" ? undefined : window.lh?.listFonts;
			if (!list) setFonts(null);
			else
				void list()
					.then((all) => setFonts(all.length ? all.filter((f) => f !== DEFAULT_READING_FONT) : null))
					.catch(() => setFonts(null));
		}
		setOpen((o) => !o);
	};

	// Any click outside the open menu, or Escape, closes it (not the dialog).
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (anchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [open]);

	return (
		<span ref={anchorRef} className="relative block">
			<button
				type="button"
				aria-label="Reading font"
				aria-expanded={open}
				data-testid="font-trigger"
				onClick={toggle}
				className="lh-press flex w-full items-center justify-between gap-2 bg-tone px-3 py-[9px] text-left text-[15px] text-ink hover:bg-tone-2"
			>
				<span className="min-w-0 truncate" style={{ fontFamily: family ? `"${family}"` : undefined }}>
					{family || DEFAULT_READING_FONT}
				</span>
				<ChevronDownIcon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
			</button>
			<MenuShell
				open={open}
				preferredSide="down"
				anchorTestid="font-trigger"
				testid="font-menu"
				menuClass="flex w-[18rem] flex-col gap-0.5 border border-border bg-card p-2 text-xs shadow-xl"
			>
				<FontMenuList
					families={fonts === undefined ? undefined : (fonts ?? [...CURATED_FALLBACK_FONTS])}
					effectiveFamily={family}
					onPick={(f) => {
						setOpen(false);
						onPick(f);
					}}
					footer={fonts === undefined ? undefined : fonts === null ? "Common fonts. Your installed fonts show in the desktop app." : "Your installed fonts"}
				/>
			</MenuShell>
		</span>
	);
}
