"use client";

/**
 * FIRST-LAUNCH ONBOARDING. Rendered by src/app/layout.tsx INSTEAD of the
 * app shell while src/server/onboarding.ts says it is needed:
 *
 *   intro → 1 Start your agent → 2 Add your first class → You're all set
 *
 * The agent step opens the agent in the godspeed folder and follows it
 * live (src/components/agent-folder); "I'll do this later" skips it. The class step is optional. Without an agent, the done step's
 * "Start your agent" goes back to step 1, whose Continue then returns to
 * the done step. Finishing writes general.onboarded and re-renders the
 * layout, which then shows Home; if that save fails, the done step stays
 * with Try again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, FolderDownIcon } from "lucide-react";
import { useAgentStatus } from "@/components/agent-status";
import { useSound } from "@/components/sounds";
import { notifySettingsSaved } from "@/components/settings-signal";
import { AgentLauncher } from "@/components/agent-folder/agent-launcher";
import { linkClassFolder, uploadClassFiles } from "@/components/files/class-files-api";
import { CLASS_FILE_ACCEPT } from "@/components/files/files-model";
import { showFocusRingAfterTab } from "@/components/focus-hygiene";
import { cn } from "@/lib/utils";
import { Constellation, type ConstellationMode } from "./constellation";

type Step = "intro" | "agent" | "class" | "done";

/** How long the intro runs before Return / the button continue. */
const INTRO_MS = 2500;

/** Return presses the step's main button, unless typing in a field
 *  wants the key (a text area) or a modifier is held. */
function useReturn(onReturn: (() => void) | null) {
	const ref = useRef(onReturn);
	ref.current = onReturn;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return;
			if (e.target instanceof HTMLTextAreaElement) return;
			if (e.target instanceof HTMLButtonElement) return; // the button's own click
			if (!ref.current) return;
			e.preventDefault();
			ref.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
}

const PRIMARY =
	"lh-press bg-ink px-7 py-3 text-[15px] font-bold text-background hover:bg-ink-max disabled:cursor-default disabled:bg-tone disabled:text-ink-3";
const QUIET = "lh-press text-[14px] font-bold text-ink-2 hover:text-ink";

export function Onboarding() {
	const router = useRouter();
	const [step, setStep] = useState<Step>("intro");
	// Return during the intro jumps its animation to the end (.ob-skip).
	const [introSkipped, setIntroSkipped] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [classId, setClassId] = useState<string | null>(null);
	// The class step is behind us: "Start your agent" on the done step comes back here, not to it again.
	const [classStepDone, setClassStepDone] = useState(false);
	// Saving "onboarded" failed: stay on the done step (leaving would show the intro again).
	const [saveFailed, setSaveFailed] = useState(false);
	const status = useAgentStatus();
	// The app shell's keyboard listener isn't mounted here yet.
	useEffect(() => showFocusRingAfterTab(document), []);

	const finish = useCallback(async () => {
		setSaveFailed(false);
		setLeaving(true);
		let saved = false;
		try {
			const read = await fetch("/api/settings", { cache: "no-store" });
			if (!read.ok) throw new Error(String(read.status));
			const current = (await read.json()) as { settings?: { general?: Record<string, unknown> } | null };
			const general = { ...(current.settings?.general ?? {}), onboarded: true, ...(classId ? { activeClass: classId } : {}) };
			const res = await fetch("/api/settings/general", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(general),
			});
			saved = res.ok;
		} catch {
			/* saved stays false */
		}
		if (!saved) {
			setLeaving(false);
			setSaveFailed(true);
			return;
		}
		notifySettingsSaved("general");
		await new Promise((r) => setTimeout(r, 600));
		router.replace("/");
		router.refresh();
	}, [classId, router]);

	const sky: ConstellationMode = step === "intro" ? "intro" : leaving ? "gone" : step === "done" ? "bright" : "backdrop";

	return (
		<div
			data-testid="onboarding"
			className={cn("ob-root relative flex h-dvh w-full flex-col overflow-hidden bg-background", step === "intro" && introSkipped && "ob-skip")}
		>
			{/* The window-drag band (Electron): first in the DOM, see globals.css. */}
			<div aria-hidden className="lh-drag absolute inset-x-0 top-0 z-10 h-12" />
			<Constellation mode={sky} />
			<div className={cn("relative flex min-h-0 flex-1 overflow-y-auto", leaving && "ob-leave")}>
				{step === "intro" && <Intro skipped={introSkipped} onSkip={() => setIntroSkipped(true)} onDone={() => setStep("agent")} />}
				{step === "agent" && <AgentStep connected={!!status?.connected} onNext={() => setStep(classStepDone ? "done" : "class")} />}
				{step === "class" && (
					<ClassStep
						onDone={(id) => {
							setClassId(id);
							setClassStepDone(true);
							setStep("done");
						}}
					/>
				)}
				{step === "done" && (
					<DoneStep
						agent={status?.connected ? { name: status.name } : null}
						onStart={() => void finish()}
						onConnect={() => setStep("agent")}
						disabled={leaving}
						failed={saveFailed}
					/>
				)}
			</div>
		</div>
	);
}

// ─── Intro ──────────────────────────────────────────────────────────────────

function Intro({ skipped, onSkip, onDone }: { skipped: boolean; onSkip: () => void; onDone: () => void }) {
	const [played, setPlayed] = useState(false);
	const play = useSound();
	useEffect(() => {
		play("intro");
		const timer = setTimeout(() => setPlayed(true), INTRO_MS);
		return () => clearTimeout(timer);
	}, [play]);
	// Return during the animation jumps to its end; after it, continues.
	useReturn(played || skipped ? onDone : onSkip);
	return (
		<div data-testid="onboarding-intro" className="flex w-full flex-col items-center justify-center pt-[6vh]">
			<div className="ob-rise flex flex-col items-center gap-6">
				<h1 className="font-title text-[64px] leading-none text-ink">godspeed</h1>
				<button type="button" data-testid="onboarding-start" className={PRIMARY} onClick={onDone}>
					Get started
				</button>
			</div>
		</div>
	);
}

// ─── Shared step chrome ─────────────────────────────────────────────────────

function StepBar({ at }: { at: 1 | 2 }) {
	const item = (n: 1 | 2, label: string) => (
		<span className={cn("text-[12.5px]", at === n ? "font-bold text-ink" : "text-ink-3")}>
			{n}&nbsp; {label}
		</span>
	);
	return (
		<div data-testid="onboarding-steps" className="flex items-center gap-2.5">
			{item(1, "Agent")}
			<span aria-hidden className="h-px w-6 bg-tone-2" />
			{item(2, "Class")}
		</div>
	);
}

function StepColumn({ at, title, sub, center = false, children }: { at: 1 | 2; title: string; sub: string; center?: boolean; children: React.ReactNode }) {
	return (
		<div className={cn("ob-step mx-auto flex w-[600px] max-w-[calc(100vw-2rem)] flex-col py-[15vh]", center && "items-center text-center")}>
			<StepBar at={at} />
			<h1 className="mt-8 font-title text-[44px] leading-tight text-ink">{title}</h1>
			<p className="mt-2 text-[15px] leading-relaxed text-ink-2">{sub}</p>
			{children}
		</div>
	);
}

// ─── 1 · Start your agent ───────────────────────────────────────────────────

function AgentStep({ connected, onNext }: { connected: boolean; onNext: () => void }) {
	const play = useSound();
	useEffect(() => {
		if (connected) play("connected");
	}, [connected, play]);
	useReturn(connected ? onNext : null);
	return (
		<StepColumn
			at={1}
			center
			title="Start your agent"
			sub="godspeed doesn't have its own AI. Your agent teaches you from its own godspeed folder, on the plan you already have."
		>
			<div className="mt-9">
				<AgentLauncher
					center
					extra={
						!connected && (
							<button type="button" data-testid="onboarding-later" className="lh-press text-[13px] font-bold text-ink-3 hover:text-ink" onClick={onNext}>
								I&apos;ll do this later
							</button>
						)
					}
				/>
			</div>
			{connected && (
				<div className="mt-9 flex justify-center">
					<button type="button" data-testid="onboarding-agent-continue" className={PRIMARY} onClick={onNext}>
						Continue
					</button>
				</div>
			)}
		</StepColumn>
	);
}

// ─── 2 · Add your first class ───────────────────────────────────────────────

/** What the drop zone holds: a folder to link, or files to copy in. */
type Picked = { kind: "folder"; path: string } | { kind: "files"; files: File[] } | null;

/** The drop zone's summary line. Pure — exported for tests. */
export function pickedLabel(picked: Picked): string | null {
	if (!picked) return null;
	if (picked.kind === "folder") return `Folder: ${picked.path}`;
	const names = picked.files.map((f) => f.name);
	return `${names.length} file${names.length === 1 ? "" : "s"}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`;
}

function ClassStep({ onDone }: { onDone: (classId: string | null) => void }) {
	const [name, setName] = useState("");
	const [picked, setPicked] = useState<Picked>(null);
	const [over, setOver] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Set when the class was made but some files failed: Continue goes on.
	const [madeId, setMadeId] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const canSave = (name.trim() !== "" || madeId !== null) && !busy;

	const save = useCallback(async () => {
		if (madeId) return onDone(madeId);
		if (name.trim() === "" || busy) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/classes", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: name.trim() }),
			});
			const body = (await res.json().catch(() => ({}))) as { class?: { id: string }; error?: string };
			if (!res.ok || !body.class) {
				setError(body.error ?? "Couldn't create the class. Try again.");
				return;
			}
			const id = body.class.id;
			const failed =
				picked?.kind === "folder" ? await linkClassFolder(id, picked.path) : picked?.kind === "files" ? await uploadClassFiles(id, picked.files, "study") : null;
			if (failed) {
				// The class exists; say what didn't make it and let them go on.
				setError(`The class was made, but some files didn't go in:\n${failed}\nYou can add them later on its Files page.`);
				setPicked(null);
				setMadeId(id);
				return;
			}
			onDone(id);
		} catch {
			setError("Network error. Try again.");
		} finally {
			setBusy(false);
		}
	}, [busy, madeId, name, onDone, picked]);
	useReturn(canSave ? () => void save() : null);

	const choose = () => {
		const pick = typeof window !== "undefined" ? window.lh?.pickFolder : undefined;
		if (pick) {
			void pick().then((path) => {
				if (path) setPicked({ kind: "folder", path });
			});
		} else fileInput.current?.click();
	};

	const onDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setOver(false);
		const items = Array.from(e.dataTransfer.items ?? []);
		const folder = items.map((i) => i.webkitGetAsEntry?.()).find((entry) => entry?.isDirectory);
		if (folder) {
			const file = items.find((i) => i.webkitGetAsEntry?.()?.isDirectory)?.getAsFile();
			const path = file && typeof window !== "undefined" ? window.lh?.pathForFile?.(file) : undefined;
			if (path) setPicked({ kind: "folder", path });
			else setError("A folder can be linked in the desktop app. Here, drop the files themselves.");
			return;
		}
		const files = Array.from(e.dataTransfer.files ?? []);
		if (files.length > 0) setPicked({ kind: "files", files });
	};

	const summary = pickedLabel(picked);
	return (
		<StepColumn at={2} title="Add your first class" sub="Each class gets its own lessons and knowledge graph. You can add more later.">
			<label className="mt-8 text-[13px] font-bold text-ink-2" htmlFor="onboarding-class-name">
				Class name
			</label>
			<input
				id="onboarding-class-name"
				data-testid="onboarding-class-name"
				autoFocus
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="e.g. CSE 21: Discrete Math"
				className="mt-2 border border-tone-2 bg-panel px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-2"
			/>
			<span className="mt-7 text-[13px] font-bold text-ink-2">Notes and slides (optional)</span>
			<input
				ref={fileInput}
				type="file"
				multiple
				accept={CLASS_FILE_ACCEPT}
				className="hidden"
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					e.target.value = "";
					if (files.length > 0) setPicked({ kind: "files", files });
				}}
			/>
			<button
				type="button"
				data-testid="onboarding-drop"
				onClick={choose}
				onDragOver={(e) => {
					e.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={onDrop}
				className={cn(
					"lh-press mt-2 flex h-[155px] flex-col items-center justify-center gap-2 border bg-panel px-6 text-center",
					over ? "border-ink-2" : "border-tone-2 hover:border-ink-3",
				)}
			>
				<FolderDownIcon className="size-5 text-ink-2" aria-hidden />
				<span className="text-[14.5px] text-ink">{summary ? "Drop to replace, or click to choose again" : "Drop files or a folder here"}</span>
				<span data-testid="onboarding-drop-hint" className="max-w-full truncate text-[12.5px] text-ink-2">
					{summary ?? "A linked folder keeps adding new notes by itself."}
				</span>
			</button>
			{error && (
				<p role="alert" className="mt-4 whitespace-pre-wrap text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
			<div className="mt-8 flex items-center justify-between">
				{madeId ? (
					<span />
				) : (
					<button type="button" data-testid="onboarding-skip" className={QUIET} onClick={() => onDone(null)}>
						Skip
					</button>
				)}
				<button type="button" data-testid="onboarding-class-continue" disabled={!canSave} className={PRIMARY} onClick={() => void save()}>
					{busy ? "Adding…" : "Continue"}
				</button>
			</div>
		</StepColumn>
	);
}

// ─── You're all set ─────────────────────────────────────────────────────────

export function DoneStep({
	agent,
	onStart,
	onConnect,
	disabled,
	failed,
}: {
	/** The connected agent, or null when none is connected yet. */
	agent: { name?: string } | null;
	onStart: () => void;
	/** Back to step 1, "Start your agent". */
	onConnect: () => void;
	disabled: boolean;
	/** Saving the finished onboarding failed. */
	failed: boolean;
}) {
	const play = useSound();
	useEffect(() => play("all-set"), [play]);
	useReturn(disabled ? null : onStart);
	return (
		<div data-testid="onboarding-done" className="ob-step m-auto flex flex-col items-center px-4 text-center">
			<span className="flex size-14 items-center justify-center border border-ans-right/50 bg-ans-right/10">
				<CheckIcon className="size-6 text-ans-right" aria-hidden />
			</span>
			<h1 className="mt-6 font-title text-[44px] leading-tight text-ink">{agent ? "You’re all set." : "You’re almost set."}</h1>
			<p className="mt-2 text-[15px] text-ink-2">
				{agent
					? `Ask ${agent.name?.trim() || "your agent"} to teach you anything, or type a topic in godspeed.`
					: "Teaching starts once an agent is connected."}
			</p>
			{failed && (
				<p role="alert" data-testid="onboarding-save-error" className="mt-4 text-[13px] text-ans-wrong">
					Couldn&apos;t save your setup.
				</p>
			)}
			<div className="mt-7 flex items-center gap-6">
				{!agent && (
					<button type="button" data-testid="onboarding-connect" className={QUIET} onClick={onConnect}>
						Start your agent
					</button>
				)}
				<button type="button" data-testid="onboarding-finish" disabled={disabled} className={PRIMARY} onClick={onStart}>
					{failed ? "Try again" : "Start learning"}
				</button>
			</div>
		</div>
	);
}
