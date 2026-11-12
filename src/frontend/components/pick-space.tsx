"use client";

import { useState } from "react";
import { useSpaces } from "@/frontend/components/space-context";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { spaceColorVar } from "@/frontend/components/space-color";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

const CHOICE = "lh-btn max-w-full text-[15px]";

/** For a space page opened with no space: the spaces to switch to and
 *  "Add a space", right on the page. */
export function PickSpace({ line }: { line: string }) {
	const { spaces, setActive } = useSpaces();
	const [creating, setCreating] = useState(false);
	const current = spaces.filter((c) => !c.archived);
	return (
		<div data-testid="pick-space" className="flex flex-col gap-3">
			<p className="text-lg text-ink-2">{line}</p>
			<div className="flex flex-wrap gap-2">
				{current.map((c) => (
					<button key={c.id} type="button" data-testid={`pick-space-${c.id}`} onClick={() => setActive(c.id)} className={CHOICE}>
						<span aria-hidden className="size-2.5 shrink-0" style={{ background: spaceColorVar(c.color) }} />
						<span title={c.name} className="min-w-0 truncate">
							{c.name}
						</span>
					</button>
				))}
				<button type="button" data-testid="pick-space-new" onClick={() => setCreating(true)} className={CHOICE}>
					<PixelIcon name="plus" />
					Add a space
				</button>
			</div>
			<SpaceDialog mode={creating ? CREATE : null} onClose={() => setCreating(false)} />
		</div>
	);
}

// The dialog compares its mode by identity: one object for every open.
const CREATE = { kind: "create" } as const;
