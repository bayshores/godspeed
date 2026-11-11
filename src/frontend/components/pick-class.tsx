"use client";

import { useState } from "react";
import { useClasses } from "@/frontend/components/class-context";
import { ClassDialog } from "@/frontend/components/class-dialog";
import { classColorVar } from "@/frontend/components/class-color";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

const CHOICE = "lh-btn max-w-full text-[15px]";

/** For a class page opened with no class: the classes to switch to and
 *  "Add a class", right on the page. */
export function PickClass({ line }: { line: string }) {
	const { classes, setActive } = useClasses();
	const [creating, setCreating] = useState(false);
	const current = classes.filter((c) => !c.archived);
	return (
		<div data-testid="pick-class" className="flex flex-col gap-3">
			<p className="text-lg text-ink-2">{line}</p>
			<div className="flex flex-wrap gap-2">
				{current.map((c) => (
					<button key={c.id} type="button" data-testid={`pick-class-${c.id}`} onClick={() => setActive(c.id)} className={CHOICE}>
						<span aria-hidden className="size-2.5 shrink-0" style={{ background: classColorVar(c.color) }} />
						<span title={c.name} className="min-w-0 truncate">
							{c.name}
						</span>
					</button>
				))}
				<button type="button" data-testid="pick-class-new" onClick={() => setCreating(true)} className={CHOICE}>
					<PixelIcon name="plus" />
					Add a class
				</button>
			</div>
			<ClassDialog mode={creating ? CREATE : null} onClose={() => setCreating(false)} />
		</div>
	);
}

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;
