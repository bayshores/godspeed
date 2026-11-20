/**
 * Settings → Connection: outside agents (Claude Code, Codex, any MCP client)
 * connect to godspeed and act as its AI, always on and the only model.
 * "Your agent": the teacher and the helper, what each is doing and the
 * buttons that start them; then the access token as one quiet line. Who
 * searches the web is set in Teaching, Facts and research.
 */

import { useState } from "react";
import { LoadingLine } from "@/frontend/components/loading";
import { useAgentStatus, useMcpAccess } from "@/frontend/components/agent-status";
import { CopyButton } from "@/frontend/components/copy-button";
import { ACCESS_ERROR, maskToken } from "@/frontend/components/mcp-access";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { AgentWindows } from "./agent-windows.tsx";
import { QUIET_KEY, SMALL_KEY } from "./controls.tsx";

export function ConnectionSection() {
	const { access, failed, rotate: rotateToken } = useMcpAccess();
	// A new token that could not be made.
	const [error, setError] = useState<string | null>(null);
	// "New token" asks first, then says what to copy again. "making": Continue
	// is off until the new token arrives, so a double click makes one token.
	const [rotate, setRotate] = useState<"idle" | "asking" | "making" | "done">("idle");

	const live = useAgentStatus();

	const makeToken = () => {
		setRotate("making");
		void rotateToken().then((refused) => {
			setError(refused === null ? null : ACCESS_ERROR);
			setRotate(refused === null ? "done" : "idle");
		});
	};

	if (!access || !live) return failed ? <p className="text-xs text-ink-2">{ACCESS_ERROR}</p> : <LoadingLine className="text-xs" />;
	const token = access.token;

	return (
		<>
			<AgentWindows agent={live} />
			<div className="flex flex-col gap-2 px-1 text-[15px]">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<PixelIcon name="lock" className="h-3.5 text-ink-2" />
					<span title="Anyone with this token can use godspeed as you. Make a new one if it leaks." className="text-ink-2">
						Access token
					</span>
					<span data-testid="agent-token" className="mr-auto min-w-0 truncate text-ink">
						{maskToken(token)}
					</span>
					<CopyButton aria-label="Copy access token" className={QUIET_KEY} text={token} />
					<button type="button" data-testid="agent-new-token" className={QUIET_KEY} disabled={rotate === "asking" || rotate === "making"} onClick={() => setRotate("asking")}>
						New token
					</button>
				</div>
				{(rotate === "asking" || rotate === "making") && (
					<div data-testid="agent-new-token-confirm" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
						<span className="text-ink">Other MCP apps will need the new token. Continue?</span>
						<span className="flex shrink-0 items-center gap-2">
							<button type="button" className={SMALL_KEY} onClick={() => setRotate("idle")}>
								Cancel
							</button>
							<button type="button" data-testid="agent-new-token-continue" className={`${SMALL_KEY} lh-btn-main`} disabled={rotate === "making"} onClick={makeToken}>
								Continue
							</button>
						</span>
					</div>
				)}
				{rotate === "done" && (
					<p data-testid="agent-new-token-note" className="text-ink-2">
						New token made. Copy it into your other MCP apps again. Claude Code and Codex pick it up by themselves.
					</p>
				)}
				{error && <p className="text-ans-wrong">{error}</p>}
			</div>
		</>
	);
}

/** The section's quiet line: who the teacher and the helper are. Only
 *  the desktop app starts the helper by itself. */
export function connectionHint(desktop: boolean): string {
	const helper = "A second run of it reads your files and builds the graph";
	return `Claude Code, Codex, or another MCP app is your teacher and teaches your lessons. ${helper}${desktop ? ", and godspeed starts it when there is reading to do" : ""}.`;
}
