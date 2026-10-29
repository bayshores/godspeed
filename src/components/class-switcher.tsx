/**
 * THE CLASS SWITCHER: the block at the top of the sidebar — the class
 * name and the up/down chevrons. Picking a class switches the whole window to it — the
 * sidebar's lessons, the graph, where new lessons start. Menu entries: every active class, "No class",
 * the archived classes (folded under "Archived"), "Edit class…" for the
 * active one, and "New class…".
 */

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, PencilIcon, PlusIcon } from "lucide-react";
import { MenuShell } from "@/components/menu-shell";
import { ClassDialog } from "@/components/class-dialog";
import { useClasses } from "@/components/class-context";
import { cn } from "@/lib/utils";

export function ClassSwitcher() {
	const { classes, active, activeClass, setActive } = useClasses();
	const [open, setOpen] = useState(false);
	const [showArchived, setShowArchived] = useState(false);
	const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; classId: string } | null>(null);
	const anchorRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (anchorRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const pick = (id: string | null) => {
		setActive(id);
		setOpen(false);
	};
	const current = classes.filter((c) => !c.archived);
	const archived = classes.filter((c) => c.archived);
	const row = "lh-press flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13.5px] text-ink hover:bg-tone";
	const name = activeClass?.name ?? "No class";

	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="class-switcher"
				data-halley-target={activeClass ? `class:${activeClass.id}` : undefined}
				onClick={() => setOpen((v) => !v)}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={`Class: ${name}`}
				className="lh-press flex w-full items-center gap-3 bg-panel px-3 py-2.5 text-left hover:bg-tone"
			>
				<span className={cn("min-w-0 flex-1 truncate text-[15px] font-bold", activeClass ? "text-ink" : "text-ink-2")}>{name}</span>
				<ChevronsUpDownIcon className="size-4 shrink-0 text-ink-2" aria-hidden />
			</button>

			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid="class-switcher-menu"
				preferredSide="down"
				align="left"
				menuClass="lh-glass flex w-[236px] flex-col gap-0.5 p-1.5"
			>
				{current.map((c) => (
					<button key={c.id} type="button" data-testid={`class-option-${c.id}`} onClick={() => pick(c.id)} className={row}>
						<span className="min-w-0 flex-1 truncate">{c.name}</span>
						{active === c.id && <CheckIcon className="size-3.5" />}
					</button>
				))}
				<button type="button" data-testid="class-option-none" onClick={() => pick(null)} className={cn(row, "text-ink-2")}>
					<span className="min-w-0 flex-1 truncate">No class</span>
					{active === null && <CheckIcon className="size-3.5" />}
				</button>
				{archived.length > 0 && (
					<>
						<button
							type="button"
							data-testid="class-show-archived"
							onClick={() => setShowArchived((v) => !v)}
							className={cn(row, "text-ink-2")}
						>
							Archived ({archived.length}) {showArchived ? "▴" : "▾"}
						</button>
						{/* The fold slides open: always mounted, inert
						    while folded so Tab and the arrows skip it. */}
						<div className="lh-collapse" data-state={showArchived ? "open" : "closed"} data-testid="class-archived-fold">
							<div className="flex flex-col gap-0.5" inert={!showArchived}>
								{archived.map((c) => (
									<button key={c.id} type="button" data-testid={`class-option-${c.id}`} onClick={() => pick(c.id)} className={cn(row, "pl-5 text-ink-2")}>
										<span className="min-w-0 flex-1 truncate">{c.name}</span>
										{active === c.id && <CheckIcon className="size-3.5" />}
									</button>
								))}
							</div>
						</div>
					</>
				)}
				<div className="my-0.5 border-t border-tone-2" aria-hidden="true" />
				{activeClass && (
					<button
						type="button"
						data-testid="class-edit"
						onClick={() => {
							setOpen(false);
							setDialog({ kind: "edit", classId: activeClass.id });
						}}
						className={row}
					>
						<PencilIcon className="size-3.5" />
						Edit class…
					</button>
				)}
				<button
					type="button"
					data-testid="class-new"
					onClick={() => {
						setOpen(false);
						setDialog({ kind: "create" });
					}}
					className={row}
				>
					<PlusIcon className="size-3.5" />
					New class…
				</button>
			</MenuShell>

			<ClassDialog mode={dialog} onClose={() => setDialog(null)} />
		</>
	);
}
