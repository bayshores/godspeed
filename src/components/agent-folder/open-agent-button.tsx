import { useCallback, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, SquareTerminalIcon } from "lucide-react";
import { MenuShell } from "@/components/menu-shell";
import { useMenuDismiss } from "@/components/use-menu-dismiss";
import { cn } from "@/lib/utils";
import { AGENT_LABEL, type LaunchChoice } from "./agent-folder-model";

const CHOICES: { id: LaunchChoice; label: string }[] = [
	{ id: "claude", label: AGENT_LABEL.claude },
	{ id: "codex", label: AGENT_LABEL.codex },
	{ id: "other", label: "Other app" },
];

/** The split button: "Open Claude Code", and a chevron menu that switches it to Codex or another app. */
export function OpenAgentButton({
	choice,
	onChoose,
	onOpen,
	busy = false,
}: {
	choice: LaunchChoice;
	onChoose: (choice: LaunchChoice) => void;
	onOpen: () => void;
	busy?: boolean;
}) {
	const [menu, setMenu] = useState(false);
	const anchorRef = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setMenu(false), []);
	useMenuDismiss(menu, close, anchorRef);
	const label = choice === "other" ? "Show the setup" : `Open ${AGENT_LABEL[choice]}`;
	return (
		<>
			<div ref={anchorRef} className="flex bg-ink text-background">
				<button
					type="button"
					data-testid="open-agent"
					disabled={busy}
					onClick={onOpen}
					className="lh-press flex items-center gap-2.5 px-6 py-3 text-[15px] font-bold hover:bg-ink-max disabled:cursor-default disabled:opacity-60"
				>
					<SquareTerminalIcon className="size-[17px]" aria-hidden />
					{label}
				</button>
				<button
					type="button"
					data-testid="open-agent-menu"
					aria-label="Choose your agent"
					aria-haspopup="menu"
					aria-expanded={menu}
					onClick={() => setMenu((v) => !v)}
					className="lh-press flex items-center border-l border-background/15 px-3 hover:bg-ink-max"
				>
					<ChevronDownIcon className="size-4" aria-hidden />
				</button>
			</div>
			<MenuShell open={menu} anchorRef={anchorRef} testid="open-agent-choices" preferredSide="down" align="right" menuClass="lh-glass flex w-[220px] flex-col gap-0.5 p-1.5">
				{CHOICES.map((c) => (
					<button
						key={c.id}
						type="button"
						data-testid={`open-agent-${c.id}`}
						onClick={() => {
							onChoose(c.id);
							setMenu(false);
						}}
						className={cn("lh-press flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13.5px] text-ink hover:bg-tone", choice === c.id && "bg-tone")}
					>
						<span className="min-w-0 flex-1 truncate">{c.label}</span>
						{choice === c.id && <CheckIcon className="size-3.5" aria-hidden />}
					</button>
				))}
			</MenuShell>
		</>
	);
}
