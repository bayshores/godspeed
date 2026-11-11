"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { classColorVar } from "@/frontend/components/class-color";
import { useClasses } from "@/frontend/components/class-context";
import { ClassDialog } from "@/frontend/components/class-dialog";
import { useUnseenFiles } from "@/frontend/components/files/files-seen";
import { cn } from "@/frontend/lib/utils";
import { classTabs } from "./class-head-model";

/**
 * The head of every class page: the class's color bar, name and
 * description, "Edit class", then the tabs. With no class picked it names
 * the lessons that belong to none.
 */
export function ClassHead() {
	const pathname = usePathname();
	const { active, activeClass } = useClasses();
	const [editing, setEditing] = useState(false);
	const unseenFiles = useUnseenFiles(active, activeClass?.lastFoundAt, pathname === "/class/files");
	// The dialog compares its mode by identity: one object per open.
	const editMode = useMemo(() => (editing && active ? { kind: "edit" as const, classId: active } : null), [editing, active]);
	return (
		<div data-testid="class-head" className="mx-auto w-full max-w-[908px] shrink-0 px-6 pt-10">
			<div className="flex items-center gap-4">
				{activeClass && <span aria-hidden className="w-2.5 shrink-0 self-stretch" style={{ background: classColorVar(activeClass.color) }} />}
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p data-testid="class-head-name" title={activeClass?.name} className="truncate text-[32px] leading-10 text-ink">
						{activeClass?.name ?? "Lessons with no class"}
					</p>
					{activeClass?.description && <p className="truncate text-[15px] text-ink-2">{activeClass.description}</p>}
				</div>
				{activeClass && (
					<button type="button" data-testid="class-edit" onClick={() => setEditing(true)} className="lh-btn lh-btn-quiet shrink-0">
						Edit class
					</button>
				)}
			</div>
			<nav aria-label={activeClass?.name ?? "Lessons with no class"} className="mt-6 flex gap-1 overflow-x-auto border-b-2 border-edge">
				{classTabs(!!activeClass).map((t) => {
					const selected = t.href === pathname;
					return (
						<Link
							key={t.href}
							href={t.href}
							data-testid={t.testid}
							aria-current={selected ? "page" : undefined}
							className={cn(
								"lh-press -mb-0.5 flex shrink-0 items-baseline gap-2 border-b-2 px-3 py-2.5 text-base whitespace-nowrap",
								selected ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
							)}
						>
							{t.label}
							{t.href === "/class/files" && activeClass && (
								<span data-testid="nav-files-count" className="font-count text-sm text-ink-2 tabular-nums">
									{activeClass.fileCount}
								</span>
							)}
							{t.href === "/class/files" && unseenFiles && (
								<span data-testid="nav-files-new" className="bg-highlight px-1.5 text-sm text-on-class">
									new
								</span>
							)}
						</Link>
					);
				})}
			</nav>
			<ClassDialog mode={editMode} onClose={() => setEditing(false)} />
		</div>
	);
}
