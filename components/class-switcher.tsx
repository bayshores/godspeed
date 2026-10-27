"use client";

/**
 * THE CLASS SWITCHER (classes wave, owner-approved 2026-10-26): the picker
 * at the top of the sidebar. Picking a class switches the whole window to
 * it — the sidebar's lessons, home's graph, where new lessons start.
 * Entries: every active class, "No class", the archived classes (folded
 * under "Archived"), "New class…", and "Edit class…" for the active one.
 */

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, PencilIcon, PlusIcon } from "lucide-react";
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
	const row = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent";

	return (
		<>
			<div className="mx-3 mb-2 flex items-center gap-1">
				<button
					ref={anchorRef}
					type="button"
					data-testid="class-switcher"
					onClick={() => setOpen((v) => !v)}
					aria-haspopup="menu"
					aria-expanded={open}
					className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/60 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
				>
					<span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Class</span>
					<span className="font-prose min-w-0 flex-1 truncate text-sm text-foreground">{activeClass?.name ?? "No class"}</span>
					<ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
				</button>
				{activeClass && (
					<button
						type="button"
						data-testid="class-edit"
						aria-label={`Edit ${activeClass.name}`}
						title="Edit class, files and folder"
						onClick={() => setDialog({ kind: "edit", classId: activeClass.id })}
						className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<PencilIcon className="size-3.5" />
					</button>
				)}
			</div>

			{open && (
				<MenuShell
					anchorRef={anchorRef}
					testid="class-switcher-menu"
					preferredSide="down"
					align="left"
					menuClass="flex w-64 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					{current.map((c) => (
						<button key={c.id} type="button" data-testid={`class-option-${c.id}`} onClick={() => pick(c.id)} className={row}>
							<span className="font-prose min-w-0 flex-1 truncate text-sm">{c.name}</span>
							{active === c.id && <CheckIcon className="size-3" />}
						</button>
					))}
					<button type="button" data-testid="class-option-none" onClick={() => pick(null)} className={cn(row, "text-muted-foreground")}>
						<span className="min-w-0 flex-1 truncate">No class</span>
						{active === null && <CheckIcon className="size-3" />}
					</button>
					{archived.length > 0 && (
						<>
							<button
								type="button"
								data-testid="class-show-archived"
								onClick={() => setShowArchived((v) => !v)}
								className={cn(row, "text-muted-foreground/80")}
							>
								Archived ({archived.length}) {showArchived ? "▴" : "▾"}
							</button>
							{showArchived &&
								archived.map((c) => (
									<button key={c.id} type="button" data-testid={`class-option-${c.id}`} onClick={() => pick(c.id)} className={cn(row, "pl-5 text-muted-foreground")}>
										<span className="font-prose min-w-0 flex-1 truncate text-sm">{c.name}</span>
										{active === c.id && <CheckIcon className="size-3" />}
									</button>
								))}
						</>
					)}
					<div className="my-0.5 border-t border-border/60" aria-hidden="true" />
					<button
						type="button"
						data-testid="class-new"
						onClick={() => {
							setOpen(false);
							setDialog({ kind: "create" });
						}}
						className={row}
					>
						<PlusIcon className="size-3" />
						New class…
					</button>
				</MenuShell>
			)}

			<ClassDialog mode={dialog} onClose={() => setDialog(null)} />
		</>
	);
}
