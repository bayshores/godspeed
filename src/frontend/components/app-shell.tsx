import { useLocation } from "react-router";
import { KeyboardShortcuts } from "@/frontend/components/keyboard-shortcuts";
import { RuleNotice } from "@/frontend/components/rule-notice";
import { SpaceNotice } from "@/frontend/components/space-notice";
import { FilesNotice } from "@/frontend/components/files-notice";
import { QuietNotice } from "@/frontend/components/quiet-notice";
import { Travel } from "@/frontend/components/travel/travel";
import { pagePlace } from "@/frontend/components/travel/travel-model";
import { useSpaces } from "@/frontend/components/space-context";
import { OpenDeadlinesProvider } from "@/frontend/components/use-open-deadlines";
import { ActiveSpaceRecordProvider } from "@/frontend/components/files/space-record";
import { ProgressProvider } from "@/frontend/components/use-progress";
import { ActiveSpaceSheetsProvider } from "@/frontend/components/cheat-sheet/space-sheets";
import { TeacherProvider } from "@/frontend/components/teacher/teacher-provider";
import { Welcome } from "@/frontend/components/welcome/welcome";
import { AppBar } from "@/frontend/components/app-bar";
import { Strip } from "@/frontend/components/strip/strip";
import { BarSlotsProvider } from "@/frontend/components/top-bar/bar-slots";
import { SearchLessons } from "@/frontend/components/search-lessons";
import { ReadNotice } from "@/frontend/components/work/read-notice";
import { MagnifiedPage, MagnifierProvider } from "@/frontend/components/magnifier/magnifier";

/** The window's page: a page change travels (travel.tsx). */
function PageTravel({ children }: { children: React.ReactNode }) {
	const { pathname } = useLocation();
	const { spaces, active } = useSpaces();
	return <Travel place={pagePlace(pathname, active, spaces)}>{children}</Travel>;
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
				{/* The active space's record, progress and sheets, read once for every page that shows
				    them, so a page opens with them drawn. */}
				<ActiveSpaceRecordProvider>
					<ProgressProvider>
						<ActiveSpaceSheetsProvider>
							{/* Around the welcome screen and the notices too: they say the teacher's name. */}
							<TeacherProvider>
								<Welcome initialOpen={welcome} whatsNewSince={whatsNewSince} />
								{/* The page puts its own words into the top bar. */}
								<BarSlotsProvider>
									<a href="#lh-page" className="lh-btn sr-only focus:not-sr-only focus:fixed focus:top-1.5 focus:left-1.5 focus:z-50">
										Skip to the page
									</a>
									<MagnifierProvider>
										<AppBar />
										{/* The strip keeps the window's right edge, and the teacher's open panel pushes the page further left (teacher-panel.tsx sets the var). */}
										<main id="lh-page" tabIndex={-1} className="lh-dots min-h-0 min-w-0 flex-1 pr-[calc(var(--lh-dock-push,0px)+var(--lh-strip))] motion-safe:transition-[padding] motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)">
											<MagnifiedPage>
												<PageTravel>{children}</PageTravel>
											</MagnifiedPage>
										</main>
									</MagnifierProvider>
								</BarSlotsProvider>
								<ReadNotice />
								<SpaceNotice />
								<RuleNotice />
								<FilesNotice />
								{/* Last, so the keyboard goes from it into its peek, which root.tsx draws next. */}
								<Strip />
							</TeacherProvider>
						</ActiveSpaceSheetsProvider>
					</ProgressProvider>
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
