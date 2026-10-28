import { memo } from "react";
import Link from "next/link";
import { FilesIcon, HouseIcon, LayoutGridIcon, WaypointsIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE CLASS NAV: Overview / Graph / Files for the
 * active class. Files shows the class's file count and is hidden under
 * "No class" (there are no class files then); Overview and Graph still
 * apply to the lessons without a class.
 */

interface NavItem {
	href: string;
	label: string;
	icon: LucideIcon;
	testid: string;
}

const CLASS_NAV: readonly NavItem[] = [
	{ href: "/class", label: "Overview", icon: LayoutGridIcon, testid: "nav-overview" },
	{ href: "/graph", label: "Graph", icon: WaypointsIcon, testid: "nav-graph" },
	{ href: "/class/files", label: "Files", icon: FilesIcon, testid: "nav-files" },
];

/** The nav row a path belongs to (exact match; lessons and home match none). */
export function activeNavHref(pathname: string): string | null {
	return CLASS_NAV.find((n) => n.href === pathname)?.href ?? null;
}

/** The nav rows' look (Home and the class nav). */
function navRowClass(active: boolean): string {
	return cn(
		"lh-press flex w-full items-center gap-2.5 px-2.5 py-2 text-[14.5px] hover:bg-tone hover:text-ink",
		active ? "bg-tone font-bold text-ink" : "text-ink-2",
	);
}

/** THE HOME ROW: above the class switcher, active on "/". */
export const HomeRow = memo(function HomeRow({ pathname }: { pathname: string }) {
	const active = pathname === "/";
	return (
		<Link
			href="/"
			data-testid="nav-home"
			data-active={active || undefined}
			aria-current={active ? "page" : undefined}
			className={navRowClass(active)}
		>
			<HouseIcon className="size-4 shrink-0" aria-hidden />
			<span className="min-w-0 flex-1 truncate">Home</span>
		</Link>
	);
});

export const ClassNav = memo(function ClassNav({
	pathname,
	hasClass,
	fileCount,
}: {
	pathname: string;
	hasClass: boolean;
	fileCount: number;
}) {
	const activeHref = activeNavHref(pathname);
	return (
		<nav aria-label="Class" className="flex w-full flex-col gap-0.5">
			{CLASS_NAV.map((item) => {
				if (item.href === "/class/files" && !hasClass) return null;
				const active = item.href === activeHref;
				const Icon = item.icon;
				return (
					<Link
						key={item.href}
						href={item.href}
						data-testid={item.testid}
						data-active={active || undefined}
						aria-current={active ? "page" : undefined}
						className={navRowClass(active)}
					>
						<Icon className="size-4 shrink-0" aria-hidden />
						<span className="min-w-0 flex-1 truncate">{item.label}</span>
						{item.href === "/class/files" && (
							<span data-testid="nav-files-count" className="px-1.5 font-mono text-xs font-bold tabular-nums text-ink-3">
								{fileCount}
							</span>
						)}
					</Link>
				);
			})}
		</nav>
	);
});
