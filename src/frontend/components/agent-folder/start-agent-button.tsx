import { useCallback, useRef, useState } from "react";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { AGENT_LABEL, type LaunchChoice } from "./agent-folder-model";

const CHOICES: { id: LaunchChoice; label: string }[] = [
	{ id: "claude", label: AGENT_LABEL.claude },
	{ id: "codex", label: AGENT_LABEL.codex },
	{ id: "other", label: "Other app" },
];

/** "Start Claude Code", and beside it "Use another agent". */
export function StartAgentButton({
	choice,
	onChoose,
	onStart,
	busy = false,
}: {
	choice: LaunchChoice;
	onChoose: (choice: LaunchChoice) => void;
	onStart: () => void;
	busy?: boolean;
}) {
	const label = choice === "other" ? "Show the setup" : `Start ${AGENT_LABEL[choice]}`;
	return (
		<div className="flex flex-wrap items-center gap-2.5">
			<button type="button" data-testid="open-agent" disabled={busy} onClick={onStart} className={cn("lh-btn lh-btn-main", BIG_BUTTON)}>
				{label}
			</button>
			<AgentMenu choice={choice} onChoose={onChoose} className={BIG_BUTTON} />
		</div>
	);
}

/** "Use another agent": its menu picks Claude Code, Codex or another app. */
export function AgentMenu({ choice, onChoose, className }: { choice: LaunchChoice; onChoose: (choice: LaunchChoice) => void; className?: string }) {
	const [menu, setMenu] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setMenu(false), []);
	useMenuDismiss(menu, close, anchorRef);
	return (
		<>
			<button ref={anchorRef} type="button" data-testid="open-agent-menu" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} className={cn("lh-btn", className)}>
				Use another agent
			</button>
			<MenuShell open={menu} anchorRef={anchorRef} testid="open-agent-choices" preferredSide="down" align="left" menuClass="lh-popup flex w-[220px] flex-col gap-0.5 p-1.5">
				{CHOICES.map((c) => (
					<button
						role="menuitem"
						key={c.id}
						type="button"
						data-testid={`open-agent-${c.id}`}
						onClick={() => {
							onChoose(c.id);
							setMenu(false);
						}}
						className={cn("lh-press flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[15px] text-ink hover:bg-tone", choice === c.id && "bg-tone")}
					>
						<span className="min-w-0 flex-1 truncate">{c.label}</span>
						{choice === c.id && <PixelIcon name="check" />}
					</button>
				))}
			</MenuShell>
		</>
	);
}
