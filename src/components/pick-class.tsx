"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { useClasses } from "@/components/class-context";
import { ClassDialog } from "@/components/class-dialog";
import { ClassIcon } from "@/components/class-icon";

const CHOICE = "lh-press flex items-center gap-2 bg-tone px-3 py-2 text-[13.5px] font-bold text-ink hover:bg-tone-2";

/** For a class page opened with No class: the classes to switch to and
 *  New class, right on the page. */
export function PickClass({ line }: { line: string }) {
	const { classes, setActive } = useClasses();
	const [creating, setCreating] = useState(false);
	const current = classes.filter((c) => !c.archived);
	return (
		<div data-testid="pick-class" className="flex flex-col gap-3">
			<p className="text-sm text-ink-2">{line}</p>
			<div className="flex flex-wrap gap-1.5">
				{current.map((c) => (
					<button key={c.id} type="button" data-testid={`pick-class-${c.id}`} onClick={() => setActive(c.id)} className={CHOICE}>
						<ClassIcon icon={c.icon} className="size-3.5 shrink-0 text-ink-2" />
						{c.name}
					</button>
				))}
				<button type="button" data-testid="pick-class-new" onClick={() => setCreating(true)} className={CHOICE}>
					<PlusIcon className="size-3.5 shrink-0" aria-hidden />
					New class
				</button>
			</div>
			<ClassDialog mode={creating ? CREATE : null} onClose={() => setCreating(false)} />
		</div>
	);
}

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;
