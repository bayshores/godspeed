/**
 * THE SETTINGS PAGE: "Settings", one tab per section, then the open
 * section. Appearance edits restyle the whole window as they are made.
 * The record and its saves come from the window's settings (settings-context).
 */

import { useEffect, useRef, useState } from "react";
import { LoadingLine } from "@/frontend/components/loading";
import { useLitMarker } from "@/frontend/components/lit-marker";
import { STRIP, useTabStrip, wheelSideways } from "@/frontend/components/tab-strip";
import { Travel } from "@/frontend/components/travel/travel";
import type { AppearanceSettings } from "@/shared/core";
import type { WriteResult } from "@/frontend/lib/api";
import { cn } from "@/frontend/lib/utils";
import { useAppearance } from "./appearance.tsx";
import { SettingsSection } from "./controls.tsx";
import { TeachingSection } from "./teaching-section.tsx";
import { GeneralSection } from "./general-section.tsx";
import { MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from "@/frontend/components/menu-shell";
import { useSettings } from "@/frontend/components/settings-context";
import { PluginsSection } from "./plugins-section.tsx";
import { AppearanceSection } from "./appearance-section.tsx";
import { ConnectionSection, connectionHint } from "./connection-section.tsx";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";

/** The tabs. A section's hint is the quiet line under it. */
const SECTIONS = [
	{ id: "general", label: "General" },
	{ id: "appearance", label: "Appearance" },
	{ id: "teaching", label: "Teaching" },
	{ id: "plugins", label: "Plugins" },
	{ id: "connection", label: "Connection", hint: connectionHint },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const DEFAULT_SECTION: SectionId = "general";

/** A requested section id → the section that shows it (unknown ids land
 *  on the default). */
export function sectionFor(id: string | undefined): SectionId {
	return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : DEFAULT_SECTION;
}

/** `section` is the id the address asked for ("/settings?section=teaching"). */
export function SettingsPage({ section }: { section?: string }) {
	const initialSection = sectionFor(section);
	const { onAppearanceChange } = useAppearance();
	const { record, teacherName, patchGeneral, saveSection, refresh } = useSettings();
	// Whole sections are saved from this copy, so it is read fresh on open.
	useEffect(() => {
		void refresh();
	}, [refresh]);
	const [error, setError] = useState<WriteResult>(null);
	// MenuShell open-count — drives the page's scroll lock.
	const [openMenus, setOpenMenus] = useState(0);
	const contentRef = useRef<HTMLDivElement | null>(null);
	// While any MenuShell is open, the page must not scroll, but
	// nothing may move either, so its scrollbar stays and wheel/touchmove
	// are blocked instead. React's wheel/touch listeners are passive, so
	// this uses native ones.
	useEffect(() => {
		const el = contentRef.current;
		if (!el || openMenus === 0) return;
		const block = (e: Event) => e.preventDefault();
		el.addEventListener("wheel", block, { passive: false });
		el.addEventListener("touchmove", block, { passive: false });
		return () => {
			el.removeEventListener("wheel", block);
			el.removeEventListener("touchmove", block);
		};
	}, [openMenus]);

	useEffect(() => {
		const onOpen = () => setOpenMenus((n) => n + 1);
		const onClose = () => setOpenMenus((n) => Math.max(0, n - 1));
		window.addEventListener(MENU_OPEN_EVENT, onOpen);
		window.addEventListener(MENU_CLOSE_EVENT, onClose);
		return () => {
			window.removeEventListener(MENU_OPEN_EVENT, onOpen);
			window.removeEventListener(MENU_CLOSE_EVENT, onClose);
		};
	}, []);
	const [active, setActive] = useState<SectionId>(initialSection);
	const navRef = useRef<HTMLElement>(null);
	const underline = useLitMarker(navRef, '[aria-current="true"]', active);
	const strip = useTabStrip('[aria-current="true"]', active);
	// Teaching's full instructions fill the page, heading and tabs included.
	const [fullPage, setFullPage] = useState(false);
	const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
	const desktop = !!useTerminals()?.available;
	// A link to another section while the page is open changes
	// initialSection under our feet — follow it.
	useEffect(() => {
		setActive(initialSection);
	}, [initialSection]);

	// A failed save shows its line above the section.
	const shown = async (saving: Promise<WriteResult>): Promise<boolean> => {
		setError(null);
		const failed = await saving;
		setError(failed);
		return failed === null;
	};

	// The Mac app reads a newly picked icon from the saved settings, so the save comes first.
	const saveAppearance = async (next: AppearanceSettings) => {
		const iconChanged = (next.appIcon ?? null) !== (record?.appearance?.appIcon ?? null);
		if (!(await shown(saveSection("appearance", next)))) return;
		onAppearanceChange(next);
		const apply = window.lh?.applyAppIcon;
		if (iconChanged && apply) await shown(apply().then(() => null, (failed: unknown) => String(failed)));
	};

	return (
		// An area's full instructions are a deeper page; the sections lie side by side in the order of their tabs.
		<Travel place={{ key: fullPage ? "instructions" : "sections", depth: fullPage ? 1 : 0, column: 0 }}>
		<div ref={contentRef} data-testid="settings-page" className="h-full overflow-y-auto">
			<div className="@container/page lh-page flex flex-col pt-(--lh-page-top) pb-(--lh-page-end)">
				{!fullPage && <h1 className="lh-page-title">Settings</h1>}
				<nav ref={navRef} hidden={fullPage} aria-label="Settings sections" data-testid="settings-nav" className="lh-tabs relative isolate mt-(--lh-head-gap) mb-(--lh-gap)">
					<div ref={underline} hidden aria-hidden className="lh-lit-marker lh-tab-line" />
					<div ref={strip.ref} onScroll={strip.measure} onWheel={wheelSideways} className={cn("flex gap-x-1.5", STRIP)}>
						{SECTIONS.map((s) => {
							const on = active === s.id;
							return (
								<button
									key={s.id}
									type="button"
									data-testid={`settings-nav-${s.id}`}
									aria-current={on}
									onClick={() => setActive(s.id)}
									className="lh-press lh-tab"
								>
									{s.label}
								</button>
							);
						})}
					</div>
				</nav>
				<div data-testid="settings-content">
					{error && (
						<p
							role="alert"
							className="mb-4 border border-ans-wrong/40 px-3 py-2 text-xs text-ans-wrong"
							data-testid="settings-error"
						>
							{error}
						</p>
					)}
					{record === undefined ? (
						<LoadingLine className="text-xs">Loading settings…</LoadingLine>
					) : record === null ? (
						<p className="text-xs text-ink-2">
							Settings could not be loaded. Refresh to retry.
						</p>
					) : (
						<Travel place={{ key: active, depth: 0, column: SECTIONS.indexOf(current) }}>
							{active === "connection" && (
								<SettingsSection title="Connection" testid="section-connection">
									<ConnectionSection />
								</SettingsSection>
							)}
							{active === "teaching" && (
								<SettingsSection title="Teaching" testid="section-teaching">
									<TeachingSection
										agent={record.agent}
										graph={record.graph}
										onGraphChange={(next) => void shown(saveSection("graph", next))}
										teacherName={teacherName}
										onSectionChange={(next) => void shown(saveSection("agent", next))}
										onFullPage={setFullPage}
									/>
								</SettingsSection>
							)}
							{active === "plugins" && (
								<SettingsSection title="Plugins" testid="section-plugins">
									<PluginsSection />
								</SettingsSection>
							)}
							{active === "appearance" && (
								<SettingsSection title="Appearance" testid="section-appearance">
									<AppearanceSection appearance={record.appearance} onSectionChange={(next) => void saveAppearance(next)} />
								</SettingsSection>
							)}
							{active === "general" && (
								<SettingsSection title="General" testid="section-general">
									<GeneralSection
										record={record}
										onGeneralChange={(fields) => void shown(patchGeneral(fields))}
									/>
								</SettingsSection>
							)}
							{"hint" in current && (
								<p data-testid="settings-hint" className="max-w-(--lh-measure) pt-(--lh-gap) text-sm text-ink-2">
									{current.hint(desktop)}
								</p>
							)}
						</Travel>
					)}
				</div>
			</div>
		</div>
		</Travel>
	);
}
