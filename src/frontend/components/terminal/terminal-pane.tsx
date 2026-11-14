/**
 * One agent's live screen and, under it, the sentence about what is
 * happening with its buttons: Paste and Stop stay quiet, and the assist
 * key or Start again is the one bright key. The overlay and onboarding's
 * first start show it.
 */
import { useEffect, useState } from "react";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import type { TerminalFooter, TerminalRole } from "./terminal-model";
import type { TerminalsApi } from "./use-terminals";

/** xterm loads with the first screen shown. */
const TerminalView = lazyComponent(() => import("./terminal-view").then((m) => m.TerminalView));

export function TerminalPane({ api, role, foot }: { api: TerminalsApi; role: TerminalRole; foot: TerminalFooter }) {
	const term = api[role]!;
	const [focusKey, setFocusKey] = useState(0);
	const [error, setError] = useState<string | null>(null);
	// A refusal shows until what the footer says changes.
	useEffect(() => setError(null), [term.id, foot.text]);
	const live = !term.ended;
	const refocus = () => setFocusKey((n) => n + 1);
	const startAgain = async () => setError(await api.start(role, term.agent));

	return (
		<>
			<TerminalView key={term.id} id={term.id} ended={!live} focusOnOpen={api.focusOnOpen} focusKey={focusKey} />
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
		</>
	);
}
