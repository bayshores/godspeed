/**
 * THE SETUP CARD: whether the picked agent can teach, and the key that fixes what stops it. Full
 * (Settings › Teacher, onboarding's first step, the teacher's panel while the agent can't run): the
 * agent pick, the Version and Account rows, then the model new chats and lessons start on once both
 * pass. Compact (where a send failed and the panel is shut): one sentence that names the agent and
 * the failing row's key. The words come from agent-card-model.ts; the state from the server.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FolderAgent } from "@/shared/core";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { useAgentFolderView } from "@/frontend/components/agent-folder/agent-folder-context";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { CopyButton } from "@/frontend/components/copy-button";
import { useReplayOnChange } from "@/frontend/components/motion";
import { useSound } from "@/frontend/components/sounds";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { FIELD, SELECT, SELECT_ARROW } from "@/frontend/components/ui/field";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Segmented } from "@/frontend/components/ui/segmented";
import { useFold } from "@/frontend/components/use-fold";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { useSheetGlide } from "@/frontend/components/use-sheet-glide";
import { cn } from "@/frontend/lib/utils";
import { cantRun, cardRows, compact, ready, type CardRow, type RowKey } from "./agent-card-model";
import { cancelLogin, sendLoginCode, startLogin, startUpdate } from "./agent-setup-api";
import { useAgentSetup } from "./agent-setup-context";

const AGENTS = (["claude", "codex"] as const).map((value) => ({ value, label: AGENT_LABEL[value] }));

/** The full card. `foot`: rows only Settings has (the name, the folder, the start command). */
export function AgentCard({ foot }: { foot?: ReactNode }) {
	const { health } = useAgentSetup();
	useReadySound();
	const { view, pick } = useAgentFolderView();
	const agent: FolderAgent = health?.agent ?? view?.agent ?? "claude";
	const action = useGuardedAction();
	const glide = useSheetGlide(false);
	return (
		<div ref={glide} data-testid="agent-card" className="flex flex-col gap-4">
			<Segmented
				label="Your teacher's agent"
				testid="agent-card-agent"
				options={AGENTS}
				value={agent}
				disabled={false}
				onChange={(next) => void action.run(() => pick(next).then(() => null, (err: Error) => err.message))}
			/>
			<Rows action={action} />
			{action.error && (
				<p role="alert" className="lh-rise text-[15px] text-ans-wrong">
					{action.error}
				</p>
			)}
			{ready(health) && <ModelRow agent={agent} />}
			{foot}
		</div>
	);
}

/** The compact card stands in a failed send's error line while the agent can't run and the
 *  teacher's panel, which then shows the full card, is shut: one card per screen. */
export function useCompactShown(): boolean {
	const { health } = useAgentSetup();
	const panelOpen = useTeacher()?.panelOpen ?? false;
	return cantRun(health) && !panelOpen;
}

/** The compact card where a send failed (see useCompactShown). */
export function AgentCompact() {
	const { health, update } = useAgentSetup();
	useReadySound();
	const action = useGuardedAction();
	const said = compact(health, update);
	if (!said) return null;
	return (
		<div data-testid="agent-compact" className="lh-rise flex flex-col gap-3 lh-well px-4 py-3 text-base">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
				<span className="text-ink">{said.sentence}</span>
				<RowEnd row={said.row} action={action} main />
			</div>
			<RowUnder row={said.row} action={action} />
			{action.error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{action.error}
				</p>
			)}
		</div>
	);
}

/** The "connected" sound once the agent can teach, where the card saw it could not (or before the
 *  first check answered). A card opened on a ready agent stays quiet. */
function useReadySound(): void {
	const { health } = useAgentSetup();
	const play = useSound();
	const now = ready(health);
	const was = useRef(now);
	useEffect(() => {
		if (now && !was.current) play("connected");
		was.current = now;
	}, [now, play]);
}

type Action = ReturnType<typeof useGuardedAction>;

/** The checks' rows. A row's words step in when they change; the first answers after the blank
 *  rows step in one by one, 40 ms apart. */
function Rows({ action }: { action: Action }) {
	const { health, update } = useAgentSetup();
	const rows = cardRows(health, update);
	const blank = rows.every((row) => row.fact === null && row.keys.length === 0 && (row.mark === "busy" || row.mark === "none"));
	const wasBlank = useRef(blank);
	const stagger = wasBlank.current && !blank;
	useEffect(() => {
		wasBlank.current = blank;
	});
	return (
		<div data-testid="agent-card-rows" className="flex flex-col">
			{rows.map((row, index) => (
				<Row key={row.id} row={row} delay={stagger ? index * 40 : 0} action={action} main={row.keys.length > 0 && rows.findIndex((r) => r.keys.length > 0) === index} />
			))}
		</div>
	);
}

function Row({ row, delay, action, main }: { row: CardRow; delay: number; action: Action; main: boolean }) {
	const said = useRef<HTMLDivElement>(null);
	useReplayOnChange(said, `${row.mark} ${row.fact} ${row.note} ${row.keys.map(keyLabel).join(" ")}`, "lh-block-in");
	return (
		<div data-testid={row.id === "version" ? "agent-row-version" : row.id === "account" ? "agent-row-account" : "agent-row-own"} data-mark={row.mark} className="flex flex-col py-2">
			<div ref={said} style={{ "--lh-block-delay": `${delay}ms` } as CSSProperties} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
				<Mark mark={row.mark} />
				<span className="text-[17px] text-ink">{row.name}</span>
				{row.fact && (
					<span data-testid={`agent-row-${row.id}-fact`} title={row.tip ?? undefined} className="min-w-0 text-[15px] text-ink-2">
						{row.fact}
					</span>
				)}
				<span className="ml-auto flex items-center gap-2.5">
					<RowEnd row={row} action={action} main={main} />
				</span>
			</div>
			<div className="pl-7">
				<RowUnder row={row} action={action} />
			</div>
		</div>
	);
}

/** The row's mark. Its color fades as it changes. */
function Mark({ mark }: { mark: CardRow["mark"] }) {
	if (mark === "busy") return <BrailleSpinner label="Checking" className="w-4 text-ink-2" />;
	return (
		<span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
			{mark === "tick" ? (
				<PixelIcon name="check" className="h-[7px] text-ans-right" />
			) : (
				<span className={cn("size-2.5 transition-colors duration-(--lh-dur)", mark === "none" ? "bg-transparent" : "bg-highlight", mark === "wait" && "ob-pulse")} />
			)}
		</span>
	);
}

const keyLabel = (key: RowKey): string => (key.kind === "cancel" ? "Cancel" : key.kind === "check" ? "Check again" : key.label);

/** What stands at the row's end: its keys, or a word in a key's place ("Updated"). */
function RowEnd({ row, action, main }: { row: CardRow; action: Action; main: boolean }) {
	if (row.note) return <span className="text-[15px] text-ink-2">{row.note}</span>;
	return (
		<>
			{row.keys.map((key, n) => (
				<Key key={keyLabel(key)} k={key} action={action} className={cn("lh-btn lh-btn-small", main && n === 0 && "lh-btn-main")} />
			))}
		</>
	);
}

/** Under the row: the sign-in's code field and keys, or a failed update's command to run. */
function RowUnder({ row, action }: { row: CardRow; action: Action }) {
	const signing = useFold(row.signing !== null);
	const run = useFold(row.run !== null);
	const last = useRef(row);
	if (row.signing || row.run) last.current = row;
	const shown = last.current;
	return (
		<>
			{signing.mounted && shown.signing && (
				<div className="lh-collapse" data-state={signing.state}>
					<div>
						<Signing code={shown.signing.code} keys={shown.signing.keys} action={action} />
					</div>
				</div>
			)}
			{run.mounted && shown.run && (
				<div className="lh-collapse" data-state={run.state}>
					<div>
						<div data-testid="agent-update-command" className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2 text-[15px]">
							<span className="text-ink-2">Or run this in Terminal:</span>
							<code className="font-mono text-ink">{shown.run}</code>
							<CopyButton text={shown.run} className="lh-btn lh-btn-quiet lh-btn-small" />
						</div>
					</div>
				</div>
			)}
		</>
	);
}

/** Claude Code's sign-in may ask for the code its page shows; both sign-ins can open the page
 *  again or be cancelled. */
function Signing({ code, keys, action }: { code: boolean; keys: RowKey[]; action: Action }) {
	const [typed, setTyped] = useState("");
	return (
		<div className="flex flex-col gap-2.5 pt-2">
			{code && (
				<form
					data-testid="agent-login-code"
					className="flex items-center gap-2.5"
					onSubmit={(e) => {
						e.preventDefault();
						void action.run(() => sendLoginCode(typed)).then((sent) => sent && setTyped(""));
					}}
				>
					<input
						type="text"
						aria-label="Code"
						placeholder="Code, if the page shows one"
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						className={cn(FIELD, "min-w-0 flex-1")}
					/>
					<button type="submit" disabled={!typed.trim() || action.busy} className="lh-btn lh-btn-main shrink-0">
						Send
					</button>
				</form>
			)}
			<div className="flex flex-wrap items-center gap-2.5">
				{keys.map((key) => (
					<Key key={keyLabel(key)} k={key} action={action} className="lh-btn lh-btn-quiet" />
				))}
			</div>
		</div>
	);
}

/** One key: a page outside godspeed, or a request the server runs. */
function Key({ k, action, className }: { k: RowKey; action: Action; className: string }) {
	const { health, checkAgain } = useAgentSetup();
	if (k.kind === "open")
		return (
			<a href={k.href} target="_blank" rel="noopener noreferrer" data-testid="agent-key" className={className}>
				{k.label}
			</a>
		);
	const does = (): Promise<string | null> => {
		if (k.kind === "login") return startLogin(health?.agent === "codex");
		if (k.kind === "cancel") return cancelLogin();
		if (k.kind === "update") return startUpdate();
		return checkAgain();
	};
	return (
		<button type="button" data-testid="agent-key" disabled={action.busy} className={className} onClick={() => void action.run(does)}>
			{keyLabel(k)}
		</button>
	);
}

/** The model new chats and lessons start on: the agent's models, its own default first. */
function ModelRow({ agent }: { agent: FolderAgent }) {
	const { view, pickModel } = useAgentFolderView();
	const { value } = useServerResource<{ agent: FolderAgent; models: { id: string; name: string; default: boolean }[] }>("/api/agent/models");
	const action = useGuardedAction();
	const models = value?.agent === agent ? value.models : null;
	if (!models || models.length === 0) return null;
	const fallback = models.find((m) => m.default) ?? models[0]!;
	const saved = view?.model[agent] ?? null;
	const picked = models.find((m) => m.id === saved) ?? fallback;
	return (
		// It steps in after the two rows that answered with it (40 ms apart).
		<div data-testid="agent-model" style={{ "--lh-block-delay": "80ms" } as CSSProperties} className="lh-block-in flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2">
			<span className="text-[17px] text-ink">Model</span>
			<span className="relative w-[224px] shrink-0">
				<select
					aria-label="Model"
					data-testid="agent-model-select"
					value={picked.id}
					disabled={action.busy}
					onChange={(e) => {
						const next = models.find((m) => m.id === e.target.value);
						// The agent's own default is saved as no pick, so it follows the agent's default.
						void action.run(() => pickModel(agent, !next || next.default ? null : next.id).then(() => null, (err: Error) => err.message));
					}}
					className={SELECT}
				>
					{models.map((m) => (
						<option key={m.id} value={m.id}>
							{m.name}
						</option>
					))}
				</select>
				<PixelIcon name="chevron" className={SELECT_ARROW} />
			</span>
			{action.error && (
				<p role="alert" className="w-full text-[15px] text-ans-wrong">
					{action.error}
				</p>
			)}
		</div>
	);
}
