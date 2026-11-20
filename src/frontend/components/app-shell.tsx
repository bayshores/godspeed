import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";
import { KeyboardShortcuts } from "@/frontend/components/keyboard-shortcuts";
import { RuleNotice } from "@/frontend/components/rule-notice";
import { SpaceNotice } from "@/frontend/components/space-notice";
import { FilesNotice } from "@/frontend/components/files-notice";
import { QuietNotice } from "@/frontend/components/quiet-notice";
import { replay } from "@/frontend/components/motion";
import { OpenDeadlinesProvider } from "@/frontend/components/use-open-deadlines";
import { ActiveSpaceRecordProvider } from "@/frontend/components/files/space-record";
import { TeacherProvider } from "@/frontend/components/teacher/teacher-provider";
import { Welcome } from "@/frontend/components/welcome/welcome";
import { AppBar } from "@/frontend/components/app-bar";
import { Strip } from "@/frontend/components/strip/strip";
import { BarSlotsProvider } from "@/frontend/components/top-bar/bar-slots";
import { SearchLessons } from "@/frontend/components/search-lessons";
import { ReadNotice } from "@/frontend/components/work/read-notice";

/** The view swap: switching between pages (Today, a lesson, Progress…)
 *  rises the incoming page in once. */
function ViewSwap({ children }: { children: React.ReactNode }) {
	const { pathname } = useLocation();
	const ref = useRef<HTMLDivElement>(null);
	const prev = useRef(pathname);
	useLayoutEffect(() => {
		const from = prev.current;
		prev.current = pathname;
		if (from === pathname) return;
		replay(ref.current, "lh-rise");
	}, [pathname]);
	return (
		<div ref={ref} className="h-full" style={{ animationDuration: "var(--lh-dur-slow)" }}>
			{children}
		</div>
	);
}

/** The app frame: the top bar over the page, and the welcome screen over
 *  everything at launch. Rendered once by src/frontend/routes/root.tsx. */
export function AppShell({
	children,
	welcome,
	whatsNewSince,
}: {
	children: React.ReactNode;
	welcome: boolean;
	whatsNewSince: string | null;
}) {
	return (
		<>
			<OpenDeadlinesProvider>
				{/* The active space's record, read once for every page that shows it. */}
				<ActiveSpaceRecordProvider>
					{/* Around the welcome screen and the notices too: they say the teacher's name. */}
					<TeacherProvider>
						<Welcome initialOpen={welcome} whatsNewSince={whatsNewSince} />
						{/* The page puts its own words into the top bar. */}
						<BarSlotsProvider>
							<a href="#lh-page" className="lh-btn sr-only focus:not-sr-only focus:fixed focus:top-1.5 focus:left-1.5 focus:z-50">
								Skip to the page
							</a>
							<AppBar />
							{/* The strip keeps the window's right edge, and the teacher's open panel pushes the page further left (teacher-panel.tsx sets the var). */}
							<main id="lh-page" tabIndex={-1} className="lh-dots min-h-0 min-w-0 flex-1 pr-[calc(var(--lh-dock-push,0px)+var(--lh-strip))] motion-safe:transition-[padding] motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)">
								<ViewSwap>{children}</ViewSwap>
							</main>
						</BarSlotsProvider>
						<ReadNotice />
						<SpaceNotice />
						<RuleNotice />
						<FilesNotice />
						{/* Last, so the keyboard goes from it into its peek, which root.tsx draws next. */}
						<Strip />
					</TeacherProvider>
				</ActiveSpaceRecordProvider>
			</OpenDeadlinesProvider>
			{/* The single document-level keydown listener: window-level, so its
			    place in the tree only matters for the events it dispatches. */}
			<KeyboardShortcuts />
			<SearchLessons />
			<QuietNotice />
		</>
	);
}
