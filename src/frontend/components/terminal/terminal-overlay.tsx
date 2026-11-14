/**
 * The agents' screens, over the dimmed page: the teacher's terminal, and
 * the helper's on a second tab while one exists. The live screen is the
 * main thing; under it one sentence about what is happening and at most
 * one bright key (the assist key or Start again). Only Hide or a click on
 * the dim closes it: Escape belongs to the agent.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/frontend/lib/utils";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { useBackdropDismiss } from "@/frontend/components/backdrop-dismiss";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { terminalFooter, type TerminalRole } from "./terminal-model";
import { useTerminals, type TerminalsApi } from "./use-terminals";

/** xterm loads with the first screen shown. */
const TerminalView = lazyComponent(() => import("./terminal-view").then((m) => m.TerminalView));

export function TerminalOverlay({ name }: { name: string }) {
	const api = useTerminals();
	const { mounted, state, shown } = useLastWhileClosing(api?.overlay ?? null);
	if (!api || !mounted || !shown || typeof document === "undefined") return null;
	const role = shown === "helper" && api.helper ? "helper" : "teacher";
	if (!api[role]) return null;
	return createPortal(<OverlayBody api={api} role={role} name={name} state={state} />, document.body);
}

function OverlayBody({ api, role, name, state }: { api: TerminalsApi; role: TerminalRole; name: string; state: "open" | "closed" }) {
	const facts = api.facts[role]!;
	const term = facts.term;
	const backdrop = useBackdropDismiss(api.hide);
	const [focusKey, setFocusKey] = useState(0);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => setError(null), [term.id]);
	const foot = terminalFooter(facts, { name, folder: api.folder });
	const live = !term.ended;
	const refocus = () => setFocusKey((n) => n + 1);
	const startAgain = async () => setError(await api.start(role, term.agent));
	const tabs: { role: TerminalRole; label: string }[] = api.helper ? [{ role: "teacher", label: name }, { role: "helper", label: "Helper" }] : [];

	return (
		<div data-state={state} inert={state === "closed"} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 pt-16 pb-4" {...backdrop}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={role === "teacher" ? name : "Helper"}
				data-terminal-overlay=""
				data-testid="terminal-overlay"
				data-state={state}
				className="lh-dialog flex h-[680px] max-h-full w-[960px] max-w-full flex-col overflow-hidden rounded border-2 border-line bg-panel"
			>
				<div className="flex shrink-0 items-center gap-1.5 border-b-[1.5px] border-line pr-3.5 pl-5">
					{tabs.length === 0 ? (
						<h2 className="min-w-0 flex-1 truncate py-2.5 text-lg text-ink">{name}</h2>
					) : (
						<div role="tablist" aria-label={name} className="flex min-w-0 flex-1 gap-1.5">
							{tabs.map((t) => (
								<button
									key={t.role}
									type="button"
									role="tab"
									aria-selected={role === t.role}
									data-testid={`terminal-tab-${t.role}`}
									onClick={() => api.show(t.role)}
									className={cn(
										"lh-press -mb-px truncate border-b-2 px-3.5 py-2.5 text-lg",
										role === t.role ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink",
									)}
								>
									{t.label}
								</button>
							))}
						</div>
					)}
					<button type="button" data-testid="terminal-hide" onClick={api.hide} className="lh-btn lh-btn-quiet my-1.5 shrink-0 text-[15px]">
						Hide
					</button>
				</div>
				<TerminalView key={term.id} id={term.id} ended={!live} focusKey={focusKey} />
				{/* In a narrow window the buttons move under the sentence. */}
				<div className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-border py-3.5 pr-3.5 pl-6">
					<p data-testid="terminal-footer" role="status" className="min-w-64 flex-1 text-lg text-ink">
						{error ?? foot.text}
					</p>
					<div className="ml-auto flex shrink-0 items-center gap-2.5">
						{live && (
							<>
								<button
									type="button"
									data-testid="terminal-paste"
									onClick={() => {
										void api.paste(role).then(setError);
										refocus();
									}}
									className="lh-btn lh-btn-quiet shrink-0 text-[15px]"
								>
									Paste
								</button>
								<button type="button" data-testid="terminal-stop" onClick={() => api.stop(role)} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
									Stop
								</button>
							</>
						)}
						{foot.get && (
							<button type="button" data-testid="terminal-get" onClick={() => void window.lh?.openLink?.(foot.get!.url)} className="lh-btn shrink-0 text-[15px]">
								{foot.get.label}
							</button>
						)}
						{foot.assist && (
							<button
								type="button"
								data-testid="terminal-assist"
								onClick={() => {
									void api.answer(role, foot.assist!.kind).then(setError);
									refocus();
								}}
								className="lh-btn lh-btn-main shrink-0 text-[15px]"
							>
								{foot.assist.label}
							</button>
						)}
						{foot.startAgain && (
							<button type="button" data-testid="terminal-start-again" onClick={() => void startAgain()} className="lh-btn lh-btn-main shrink-0 text-[15px]">
								Start again
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
