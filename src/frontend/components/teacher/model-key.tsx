import { useCallback, useRef, useState } from "react";
import { shownModel, type AgentModel } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { cn } from "@/frontend/lib/utils";

/**
 * The chat's model key in the panel's writing row: the model the chat's next reply runs on, by the
 * name the agent gives it, or the agent's own default before any pick. A press opens a menu of the
 * agent's models, the current one ticked; a pick changes only this chat. With no list from the
 * agent there is nothing to pick from, so the key is not drawn.
 */
export function ModelKey({ models, current, onPick }: { models: readonly AgentModel[]; current: string | null; onPick: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchor = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchor);
	const shown = shownModel(models, current);
	if (!shown) return null;
	return (
		<>
			<button ref={anchor} type="button" data-testid="talk-model" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="lh-btn shrink-0 gap-2">
				{shown.name}
				<PixelIcon name="chevron" className={cn("transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open ? "rotate-90" : "-rotate-90")} />
			</button>
			<MenuShell open={open} anchorRef={anchor} testid="talk-models" preferredSide="up" align="right" menuClass="lh-popup flex w-[240px] flex-col gap-0.5 p-1.5">
				{models.map((m) => (
					<button
						role="menuitem"
						key={m.id}
						type="button"
						data-testid="talk-model-choice"
						onClick={() => {
							onPick(m.id);
							setOpen(false);
						}}
						className={cn("lh-press flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-ui text-ink hover:bg-tone", m.id === shown.id && "bg-tone")}
					>
						<span className="min-w-0 flex-1 truncate">{m.name}</span>
						{m.id === shown.id && <PixelIcon name="check" />}
					</button>
				))}
			</MenuShell>
		</>
	);
}
