import Link from "next/link";
import { useClasses } from "@/frontend/components/class-context";
import { classColorVar } from "@/frontend/components/class-color";
import { cn } from "@/frontend/lib/utils";

/** A top bar tab: the lit one is a block of the page's paper. */
export const BAR_TAB = "lh-press flex min-w-0 items-center gap-2 px-4 text-[15px] whitespace-nowrap";
export const barTabState = (lit: boolean) => (lit ? "bg-background font-medium text-ink" : "text-bar-ink hover:bg-bar-ink/10");

/**
 * Today, then one tab per class (archived ones are under Menu). A class's
 * tab switches the window to it and opens its Progress page.
 */
export function ClassTabs({ selected }: { selected: string }) {
	const { classes, setActive } = useClasses();
	return (
		<nav aria-label="Classes" data-testid="class-tabs" className="flex min-w-0 flex-1 items-stretch overflow-hidden">
			<Link href="/" data-testid="nav-today" aria-current={selected === "today" ? "page" : undefined} className={cn(BAR_TAB, "shrink-0", barTabState(selected === "today"))}>
				Today
			</Link>
			{classes
				.filter((c) => !c.archived)
				.map((c) => (
					<Link
						key={c.id}
						href="/class"
						prefetch={false}
						data-testid={`class-option-${c.id}`}
						data-halley-target={`class:${c.id}`}
						aria-current={selected === c.id ? "page" : undefined}
						onClick={() => setActive(c.id)}
						className={cn(BAR_TAB, barTabState(selected === c.id))}
					>
						<span aria-hidden className="size-2.5 shrink-0" style={{ background: classColorVar(c.color) }} />
						<span title={c.name} className="truncate">
							{c.name}
						</span>
					</Link>
				))}
		</nav>
	);
}
