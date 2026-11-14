/**
 * THE SETTINGS PAGE: "Settings", one tab per section, then the open
 * section. Appearance edits restyle the whole window as they are made.
 *
 * One record instance for the whole page: sections write through the
 * single `write` seam, and switching sections never refetches.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CURRENT_SETTINGS_VERSION, DEFAULT_TEACHER_NAME, type AppearanceSettings, type UserSettings } from "@/shared/core";
import { useAppearance } from "./appearance.tsx";
import { SettingsSection } from "./controls.tsx";
import { TeachingSection } from "./teaching-section.tsx";
import { GeneralSection } from "./general-section.tsx";
import { MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from "@/frontend/components/menu-shell";
import { notifySettingsSaved } from "@/frontend/components/settings-signal";
import { useServerEvent } from "@/frontend/components/server-events";
import { cn } from "@/frontend/lib/utils";
import { AppearanceSection } from "./appearance-section.tsx";
import { ConnectionSection, connectionHint } from "./connection-section.tsx";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";

/** The tabs. A section's hint is the quiet line under it. */
const SECTIONS = [
	{ id: "connection", label: "Connection", hint: connectionHint },
	{ id: "teaching", label: "Teaching" },
	{ id: "appearance", label: "Appearance" },
	{ id: "general", label: "General" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];
const DEFAULT_SECTION: SectionId = "connection";

/** A requested section id → the section that shows it (unknown ids land
 *  on the default). */
export function sectionFor(id: string | undefined): SectionId {
	return SECTIONS.some((s) => s.id === id) ? (id as SectionId) : DEFAULT_SECTION;
}

/** `section` is the id the address asked for ("/settings?section=teaching"). */
export function SettingsPage({ section }: { section?: string }) {
	const initialSection = sectionFor(section);
	const { onAppearanceChange } = useAppearance();
	const [record, setRecord] = useState<UserSettings | null | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | null>(null);
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
	// Teaching's full instructions fill the page, heading and tabs included.
	const [fullPage, setFullPage] = useState(false);
	const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
	const desktop = !!useTerminals()?.available;
	// A link to another section while the page is open changes
	// initialSection under our feet — follow it.
	useEffect(() => {
		setActive(initialSection);
	}, [initialSection]);

	// Fetch once per page mount. 200 {settings: null} is FIRST BOOT
	// (no record = factory everything), not a failure — the error state is
	// a non-200 or a network throw only.
	useEffect(() => {
		fetch("/api/settings")
			.then((r) =>
				r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`)),
			)
			.then((body: { settings: UserSettings | null }) =>
				setRecord(body.settings ?? { version: CURRENT_SETTINGS_VERSION }),
			)
			.catch(() => setRecord(null));
	}, []);
	// An agent saved, undid or edited a rule: take the new rules, so the
	// next Teaching write (which replaces the whole section) keeps them.
	useServerEvent("rules-changed", () => {
		fetch("/api/settings")
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { settings: UserSettings | null } | null) => {
				// A failed read keeps the record: writes rebuild the section from it.
				const settings = body?.settings;
				if (!settings) return;
				setRecord((prev) => (prev ? { ...prev, agent: settings.agent } : prev));
			})
			.catch(() => {});
	});

	/** ONE writer for the whole page: PUT the whole section, keep the
	 *  record mirror in sync, surface route errors inline (a 400 is a
	 *  schema mistake caught by the validation surface). */
	const write = useCallback(
		async (
			section: "general" | "agent" | "appearance" | "graph",
			body: object,
		) => {
			setError(null);
			let res: Response;
			try {
				res = await fetch(`/api/settings/${section}`, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});
			} catch {
				setError("Network error. Try again.");
				return;
			}
			if (!res.ok) {
				const detail = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				setError(`${section}: ${detail.error ?? res.status}`);
				return;
			}
			// Server truth, never the request body: the route may clean up what
			// it stores, and the writing surface must show the stored value in
			// this same interaction.
			const stored = (
				(await res.json().catch(() => null)) as { settings?: UserSettings } | null
			)?.settings;
			setRecord(
				(prev) =>
					stored ?? ({ ...(prev ?? {}), [section]: body }) as UserSettings,
			);
			notifySettingsSaved(section);
			if (section === "appearance")
				onAppearanceChange(body as AppearanceSettings);
		},
		[onAppearanceChange],
	);

	return (
		<div ref={contentRef} data-testid="settings-page" className="h-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-[1008px] flex-col px-6 pt-10 pb-12">
				{!fullPage && <h1 className="text-[40px] leading-[48px] text-ink">Settings</h1>}
				<nav hidden={fullPage} aria-label="Settings sections" data-testid="settings-nav" className="mt-6 mb-6 flex gap-1 overflow-x-auto border-b-2 border-edge">
					{SECTIONS.map((s) => {
						const on = active === s.id;
						return (
							<button
								key={s.id}
								type="button"
								data-testid={`settings-nav-${s.id}`}
								aria-current={on}
								onClick={() => setActive(s.id)}
								className={cn(
									"lh-press -mb-0.5 shrink-0 border-b-2 px-3 py-2.5 text-base whitespace-nowrap",
									on ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
								)}
							>
								{s.label}
							</button>
						);
					})}
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
						<p className="text-xs text-ink-2">
							Loading settings…
						</p>
					) : record === null ? (
						<p className="text-xs text-ink-2">
							Settings could not be loaded. Refresh to retry.
						</p>
					) : (
						<div>
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
										onGraphChange={(next) => void write("graph", next)}
										teacherName={record.general?.teacherName || DEFAULT_TEACHER_NAME}
										onSectionChange={(next) => void write("agent", next)}
										onFullPage={setFullPage}
									/>
								</SettingsSection>
							)}
							{active === "appearance" && (
								<SettingsSection title="Appearance" testid="section-appearance">
									<AppearanceSection appearance={record.appearance} onSectionChange={(next) => void write("appearance", next)} />
								</SettingsSection>
							)}
							{active === "general" && (
								<SettingsSection title="General" testid="section-general">
									<GeneralSection
										record={record}
										onGeneralChange={(next) => void write("general", next)}
									/>
								</SettingsSection>
							)}
						</div>
					)}
					{"hint" in current && (
						<p data-testid="settings-hint" className="pt-6 text-sm text-ink-2">
							{current.hint(desktop)}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
