"use client";

/**
 * FIRST-LAUNCH ONBOARDING (owner, 2026-10-27 — designs in the pen file:
 * "Onboarding — pick an opening" row D, "Onboarding — setup flow
 * (centered)"). Rendered by src/app/layout.tsx INSTEAD of the app shell while
 * src/server/onboarding.ts says it is needed:
 *
 *   intro → 1 Connect your agent → 2 Add your first class → You're all set
 *
 * The agent step waits live for the agent's first check-in (the shared
 * agent status, src/components/agent-status.tsx); "I'll do this later" skips
 * it. The class step is optional. Finishing writes general.onboarded and
 * re-renders the layout, which then shows Home.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CircleCheckIcon, CopyIcon, FolderDownIcon } from "lucide-react";
import { useAgentStatus } from "@/components/agent-status";
import { notifySettingsSaved } from "@/components/settings-signal";
import { CLAUDE_CODE_SETUP, codexConfig, maskToken } from "@/components/settings/agents-section";
import { linkClassFolder, uploadClassFiles } from "@/components/files/class-files-api";
import { CLASS_FILE_ACCEPT } from "@/components/files/files-model";
import { cn } from "@/lib/utils";
import { Constellation, type ConstellationMode } from "./constellation";

type Step = "intro" | "agent" | "class" | "done";
type AgentTab = "claude" | "codex" | "other";

/** How long the intro runs before Return / the button continue. */
const INTRO_MS = 2500;

const TABS: { id: AgentTab; label: string }[] = [
	{ id: "claude", label: "Claude Code" },
	{ id: "codex", label: "Codex" },
	{ id: "other", label: "Other app" },
];

/** The live status line's text. Pure — exported for tests. */
export function agentLine(tab: AgentTab, connected: boolean, name?: string): string {
	if (connected) return `${name?.trim() || "Your agent"} connected`;
	return tab === "other" ? "Waiting for your app…" : `Waiting for ${tab === "claude" ? "Claude Code" : "Codex"}…`;
}

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
	"lh-press bg-ink px-7 py-3 text-[15px] font-bold text-black hover:bg-white disabled:cursor-default disabled:bg-tone disabled:text-ink-3";
const QUIET = "lh-press text-[14px] font-bold text-ink-2 hover:text-ink";

export function Onboarding() {
	const router = useRouter();
	const [step, setStep] = useState<Step>("intro");
	// Return during the intro jumps its animation to the end (.ob-skip).
	const [introSkipped, setIntroSkipped] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [classId, setClassId] = useState<string | null>(null);
	const status = useAgentStatus();

	const finish = useCallback(async () => {
		setLeaving(true);
		try {
			const current = (await fetch("/api/settings", { cache: "no-store" }).then((r) => r.json())) as {
				settings?: { general?: Record<string, unknown> } | null;
			};
			const general = { ...(current.settings?.general ?? {}), onboarded: true, ...(classId ? { activeClass: classId } : {}) };
			const res = await fetch("/api/settings/general", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(general),
			});
			if (res.ok) notifySettingsSaved("general");
		} catch {
			/* the next launch shows the end of onboarding again */
		}
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
				{step === "agent" && <AgentStep connected={!!status?.connected} name={status?.name} onNext={() => setStep("class")} />}
				{step === "class" && (
					<ClassStep
						onDone={(id) => {
							setClassId(id);
							setStep("done");
						}}
					/>
				)}
				{step === "done" && <DoneStep agentName={status?.connected ? status.name : undefined} onStart={() => void finish()} disabled={leaving} />}
			</div>
		</div>
	);
}

// ─── Intro ──────────────────────────────────────────────────────────────────

function Intro({ skipped, onSkip, onDone }: { skipped: boolean; onSkip: () => void; onDone: () => void }) {
	const [played, setPlayed] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setPlayed(true), INTRO_MS);
		return () => clearTimeout(timer);
	}, []);
	// Return during the animation jumps to its end; after it, continues.
	useReturn(played || skipped ? onDone : onSkip);
	return (
		<div data-testid="onboarding-intro" className="flex w-full flex-col items-center justify-center pt-[6vh]">
			<div className="ob-rise flex flex-col items-center gap-6">
				<h1 className="font-title text-[64px] leading-none text-ink">godspeed</h1>
				<button type="button" data-testid="onboarding-start" className={PRIMARY} onClick={onDone}>
					Get started
				</button>
				<p className="-mt-3 text-[12px] text-ink-3">or press Return</p>
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

function StepColumn({ at, title, sub, children }: { at: 1 | 2; title: string; sub: string; children: React.ReactNode }) {
	return (
		<div className="ob-step mx-auto flex w-[600px] max-w-[calc(100vw-2rem)] flex-col py-[15vh]">
			<StepBar at={at} />
			<h1 className="mt-8 font-title text-[44px] leading-tight text-ink">{title}</h1>
			<p className="mt-2 text-[15px] leading-relaxed text-ink-2">{sub}</p>
			{children}
		</div>
	);
}

function CopyButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			aria-label={`Copy ${label}`}
			className="lh-press flex items-center gap-1.5 text-[12.5px] font-bold text-ink-2 hover:text-ink"
			onClick={() => {
				void navigator.clipboard.writeText(text).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}}
		>
			{copied ? <CheckIcon className="size-3.5" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

/** A copyable code block: a header (label + Copy) and the lines. */
function CodeBlock({ label, lines, copy }: { label: string; lines: string[]; copy: string }) {
	return (
		<div className="border border-tone-2 bg-panel">
			<div className="flex items-center justify-between border-b border-tone-2 px-4 py-2.5">
				<span className="text-[12.5px] text-ink-3">{label}</span>
				<CopyButton text={copy} label={label} />
			</div>
			<pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13.5px] leading-[1.9] text-ink">{lines.join("\n")}</pre>
		</div>
	);
}

function Numbered({ n, children }: { n: number; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-3 text-[14.5px] text-ink">
			<span className="flex size-[22px] shrink-0 items-center justify-center border border-tone-2 font-mono text-[11.5px] text-ink-2">{n}</span>
			<span>{children}</span>
		</div>
	);
}

// ─── 1 · Connect your agent ─────────────────────────────────────────────────

interface Access {
	token: string;
	url: string;
}

function AgentStep({ connected, name, onNext }: { connected: boolean; name?: string; onNext: () => void }) {
	const [tab, setTab] = useState<AgentTab>("claude");
	const [access, setAccess] = useState<Access | null>(null);
	useEffect(() => {
		fetch("/api/mcp-access", { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<Access>) : null))
			.then((body) => body && setAccess({ token: body.token, url: body.url }))
			.catch(() => {});
	}, []);
	useReturn(connected ? onNext : null);

	const token = access?.token ?? "";
	const url = access?.url ?? "";
	let block: React.ReactNode;
	if (tab === "claude") {
		block = (
			<>
				<Numbered n={1}>In Claude Code, run these two commands:</Numbered>
				<CodeBlock label="Claude Code" lines={CLAUDE_CODE_SETUP.split("\n")} copy={CLAUDE_CODE_SETUP} />
				<Numbered n={2}>
					Then run <span className="font-mono text-[13.5px]">/godspeed:teach</span> and leave it running. Put Claude Code in auto mode
					first, so it never stops to ask your permission.
				</Numbered>
			</>
		);
	} else if (tab === "codex") {
		block = (
			<>
				<Numbered n={1}>
					Add this to <span className="font-mono text-[13.5px]">~/.codex/config.toml</span>:
				</Numbered>
				<CodeBlock label="config.toml" lines={codexConfig(url, maskToken(token)).split("\n")} copy={codexConfig(url, token)} />
				<Numbered n={2}>
					Then ask Codex to teach you with the godspeed tools. Set Codex&apos;s approvals to Full Access first, so it never stops to ask your
					permission.
				</Numbered>
			</>
		);
	} else {
		block = (
			<>
				<Numbered n={1}>Add a Streamable HTTP MCP server with this address and header:</Numbered>
				<CodeBlock
					label="MCP server"
					lines={[url, `Authorization: Bearer ${maskToken(token)}`]}
					copy={`${url}\nAuthorization: Bearer ${token}`}
				/>
				<Numbered n={2}>
					Then ask it to teach you with the godspeed tools. Let your agent use the godspeed tools without asking your permission.
				</Numbered>
			</>
		);
	}

	return (
		<StepColumn at={1} title="Connect your agent" sub="godspeed doesn't have its own AI. Your coding agent teaches you through it, on the plan you already have.">
			<div role="tablist" aria-label="Your agent" className="mt-8 grid grid-cols-3 gap-px border border-tone-2 bg-tone-2">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tab === t.id}
						data-testid={`onboarding-tab-${t.id}`}
						onClick={() => setTab(t.id)}
						className={cn("lh-press py-3 text-[14.5px]", tab === t.id ? "bg-tone font-bold text-ink" : "bg-panel text-ink-2 hover:text-ink")}
					>
						{t.label}
					</button>
				))}
			</div>
			<div className={cn("mt-8 flex flex-col gap-4 transition-opacity duration-500", connected && "opacity-55")}>{block}</div>
			<div
				data-testid="onboarding-agent-status"
				data-connected={connected || undefined}
				aria-live="polite"
				className={cn(
					"mt-8 flex items-center gap-3 border px-4 py-3 text-[14.5px] transition-colors duration-500",
					connected ? "border-ans-right/80 bg-ans-right/[0.08] font-bold text-ink" : "border-tone-2 bg-panel text-ink-2",
				)}
			>
				{connected ? (
					<CircleCheckIcon className="size-4 text-ans-right" aria-hidden />
				) : (
					<span aria-hidden className="ob-pulse flex size-4 items-center justify-center rounded-full bg-tone-2">
						<span className="size-1.5 rounded-full bg-ink-2" />
					</span>
				)}
				{agentLine(tab, connected, name)}
			</div>
			<div className="mt-8 flex items-center justify-between">
				{connected ? (
					<span />
				) : (
					<button type="button" data-testid="onboarding-later" className={QUIET} onClick={onNext}>
						I&apos;ll do this later
					</button>
				)}
				<div className="flex items-center gap-4">
					{connected && <span className="text-[12px] text-ink-3">or press Return</span>}
					<button type="button" data-testid="onboarding-agent-continue" disabled={!connected} className={PRIMARY} onClick={onNext}>
						Continue
					</button>
				</div>
			</div>
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
				placeholder="e.g. CSE 21 — Discrete Math"
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
				<span data-testid="onboarding-drop-hint" className="max-w-full truncate text-[12.5px] text-ink-3">
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

function DoneStep({ agentName, onStart, disabled }: { agentName?: string; onStart: () => void; disabled: boolean }) {
	useReturn(disabled ? null : onStart);
	return (
		<div data-testid="onboarding-done" className="ob-step m-auto flex flex-col items-center px-4 text-center">
			<span className="flex size-14 items-center justify-center border border-ans-right/50 bg-ans-right/10">
				<CheckIcon className="size-6 text-ans-right" aria-hidden />
			</span>
			<h1 className="mt-6 font-title text-[44px] leading-tight text-ink">You’re all set.</h1>
			<p className="mt-2 text-[15px] text-ink-2">Ask {agentName ?? "your agent"} to teach you anything, or type a topic in godspeed.</p>
			<button type="button" data-testid="onboarding-finish" disabled={disabled} className={cn(PRIMARY, "mt-7")} onClick={onStart}>
				Start learning
			</button>
		</div>
	);
}
