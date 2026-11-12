import Link from "next/link";
import { useSpaces } from "@/frontend/components/space-context";
import { spaceColorVar } from "@/frontend/components/space-color";
import { tabWorkTag } from "@/frontend/components/teacher-work/teacher-work-model";
import { cn } from "@/frontend/lib/utils";

/** A top bar tab: the lit one is a block of the page's paper. */
export const BAR_TAB = "lh-press flex min-w-0 items-center gap-2 px-4 text-[15px] whitespace-nowrap";
export const barTabState = (lit: boolean) => (lit ? "bg-background font-medium text-ink" : "text-bar-ink hover:bg-bar-ink/10");

/**
 * Today, then one tab per space (archived ones are under Menu). A space's
 * tab switches the window to it and opens its Progress page; it carries a
 * tag while the teacher still has files of it to read.
 */
export function SpaceTabs({ selected }: { selected: string }) {
	const { spaces, setActive } = useSpaces();
	return (
		<nav aria-label="Spaces" data-testid="space-tabs" className="flex min-w-0 flex-1 items-stretch overflow-hidden">
			<Link href="/" data-testid="nav-today" aria-current={selected === "today" ? "page" : undefined} className={cn(BAR_TAB, "shrink-0", barTabState(selected === "today"))}>
				Today
			</Link>
			{spaces
				.filter((c) => !c.archived)
				.map((c) => {
					const tag = tabWorkTag(c);
					return (
						<Link
							key={c.id}
							href="/space"
							prefetch={false}
							data-testid={`space-option-${c.id}`}
							data-halley-target={`space:${c.id}`}
							aria-current={selected === c.id ? "page" : undefined}
							onClick={() => setActive(c.id)}
							className={cn(BAR_TAB, barTabState(selected === c.id))}
						>
							<span aria-hidden className="size-2.5 shrink-0" style={{ background: spaceColorVar(c.color) }} />
							<span title={c.name} className="truncate">
								{c.name}
							</span>
							{tag && (
								<span data-testid={`space-work-${c.id}`} title="Files the teacher still has to read" className="shrink-0 bg-highlight px-1.5 text-sm text-ink">
									{tag}
								</span>
							)}
						</Link>
					);
				})}
		</nav>
	);
}
