"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { KeyboardShortcuts } from "@/frontend/components/keyboard-shortcuts";
import { RuleNotice } from "@/frontend/components/rule-notice";
import { FilesNotice } from "@/frontend/components/files-notice";
import { QuietNotice } from "@/frontend/components/quiet-notice";
import { replayRise } from "@/frontend/components/motion";
import { OpenDeadlinesProvider } from "@/frontend/components/use-open-deadlines";
import { HalleyProvider } from "@/frontend/components/halley/halley-provider";
import { Welcome } from "@/frontend/components/welcome/welcome";
import { AppBar } from "@/frontend/components/app-bar";
import { SearchLessons } from "@/frontend/components/search-lessons";

/** The view swap: switching between pages (Today, a lesson, Progress…)
 *  rises the incoming page in once. */
function ViewSwap({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const ref = useRef<HTMLDivElement>(null);
	const prev = useRef(pathname);
	useLayoutEffect(() => {
		const from = prev.current;
		prev.current = pathname;
		if (from === pathname) return;
		replayRise(ref.current);
	}, [pathname]);
	return (
		<div ref={ref} className="h-full" style={{ animationDuration: "var(--lh-dur-slow)" }}>
			{children}
		</div>
	);
}

/** The app frame: the top bar over the page, and the welcome screen over
 *  everything at launch. Rendered once in the root layout. */
export function AppShell({
	children,
	teacherName,
	welcome,
	whatsNewSince,
}: {
	children: React.ReactNode;
	teacherName?: string;
	welcome: boolean;
	whatsNewSince: string | null;
}) {
	return (
		<>
			<OpenDeadlinesProvider>
				<Welcome initialOpen={welcome} whatsNewSince={whatsNewSince} />
				<HalleyProvider initialName={teacherName}>
					<a href="#lh-page" className="lh-btn sr-only focus:not-sr-only focus:fixed focus:top-1.5 focus:left-1.5 focus:z-50 focus:bg-card">
						Skip to the page
					</a>
					<AppBar />
					{/* The teacher's open panel pushes the page left (halley-panel.tsx sets the var). */}
					<main id="lh-page" tabIndex={-1} className="lh-dots min-h-0 min-w-0 flex-1 pr-(--lh-dock-push,0px) motion-safe:transition-[padding] motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)">
						<ViewSwap>{children}</ViewSwap>
					</main>
				</HalleyProvider>
			</OpenDeadlinesProvider>
			{/* The single document-level keydown listener: window-level, so its
			    place in the tree only matters for the events it dispatches. */}
			<KeyboardShortcuts />
			<SearchLessons />
			<RuleNotice />
			<FilesNotice />
			<QuietNotice />
		</>
	);
}
