import type { SpaceSummary } from "@/shared/core";
import { MENU_ITEM } from "@/frontend/components/menu-shell";
import { spaceColorVar } from "@/frontend/components/space-color";
import { cn } from "@/frontend/lib/utils";

/** The open spaces as menu items, one per space, each with its color square
 *  and name. A pick calls `onPick` with the space's id; the menu's owner
 *  closes the menu. Item test ids are `<testidPrefix>-<space id>`. */
export function SpaceMenuItems({ spaces, testidPrefix, onPick }: { spaces: readonly SpaceSummary[]; testidPrefix: string; onPick: (spaceId: string) => void }) {
	return spaces.map((c) => (
		<button
			role="menuitem"
			key={c.id}
			type="button"
			data-testid={`${testidPrefix}-${c.id}`}
			onClick={() => onPick(c.id)}
			className={cn(MENU_ITEM, "w-full gap-2.5")}
		>
			<span aria-hidden className="size-3 shrink-0" style={{ background: spaceColorVar(c.color) }} />
			<span title={c.name} className="min-w-0 flex-1 truncate">
				{c.name}
			</span>
		</button>
	));
}
