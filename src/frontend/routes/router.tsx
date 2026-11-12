import type { RouteObject } from "react-router";
import { HomePage } from "@/frontend/components/home-page/home-page";
import { NewLesson } from "@/frontend/components/home";
import { PrepStart } from "@/frontend/components/prep/prep-start";
import { ArchivedSpaces } from "@/frontend/components/archived-spaces";
import { GraphScreen } from "@/frontend/components/graph/graph-screen";
import { SpaceHome } from "@/frontend/components/space-page/space-home";
import { LessonsList } from "@/frontend/components/lessons/lessons-list";
import { FilesPage } from "@/frontend/components/files/files-page";
import { SpaceSheetsPage } from "@/frontend/components/cheat-sheet/space-sheets";
import { DeadlinesTab } from "@/frontend/components/space-page/deadlines-tab";
import { PrepMocksTab } from "@/frontend/components/prep/prep-mocks";
import { Root } from "./root";
import { NotFound, PageError } from "./not-found";
import { PageTitle } from "./page-title";
import { SpaceLayout } from "./space-layout";
import { SettingsRoute } from "./settings";
import { LessonPage, lessonLoader } from "./lesson";
import { CheatSheetRoute, DeadlineRoute, deadlineLoader } from "./deadline";
import { MockRoute, mockLoader } from "./mock";

/** Every screen. A page that needs data first (a lesson, a deadline, a
 *  mock) has a loader: a navigation keeps the old page until it is read,
 *  and one that is gone shows NotFound inside the app frame. */
export const routes: RouteObject[] = [
	{
		element: <Root />,
		children: [
			{
				errorElement: <PageError />,
				children: [
					// Today: what's coming up across every space, and one block per space.
					{ index: true, element: <><PageTitle /><HomePage /></> },
					// The start page: every new lesson is a study session.
					{ path: "new", element: <><PageTitle page="Study" /><NewLesson /></> },
					// "Prepare for something": where a prep starts.
					{ path: "prep", element: <><PageTitle page="Prepare" /><PrepStart /></> },
					{ path: "settings", element: <SettingsRoute /> },
					{ path: "archived", element: <><PageTitle page="Archived spaces" /><ArchivedSpaces /></> },
					{
						element: <SpaceLayout />,
						children: [
							{ path: "graph", element: <><PageTitle page="Graph" /><GraphScreen /></> },
							// Progress, or a prep's sheet.
							{ path: "space", element: <><PageTitle page="Progress" /><SpaceHome /></> },
							// With no space picked, the lessons that belong to none.
							{
								path: "space/lessons",
								element: (
									<div className="h-full overflow-y-auto">
										<PageTitle page="Lessons" />
										<h1 className="sr-only">Lessons</h1>
										<LessonsList />
									</div>
								),
							},
							{ path: "space/files", element: <><PageTitle page="Files" /><FilesPage /></> },
							{ path: "space/cheat-sheets", element: <><PageTitle page="Cheat sheets" /><SpaceSheetsPage /></> },
							{
								path: "space/deadlines",
								element: (
									<div className="h-full overflow-y-auto">
										<PageTitle page="Deadlines" />
										<h1 className="sr-only">Deadlines</h1>
										<DeadlinesTab />
									</div>
								),
							},
							{
								path: "space/mocks",
								element: (
									<div className="h-full overflow-y-auto">
										<PageTitle page="Mocks" />
										<h1 className="sr-only">Mocks</h1>
										<PrepMocksTab />
									</div>
								),
							},
						],
					},
					{ path: "space/deadline/:id", loader: deadlineLoader, element: <DeadlineRoute />, errorElement: <PageError page="Deadline" /> },
					{ path: "space/deadline/:id/cheat-sheet", loader: deadlineLoader, element: <CheatSheetRoute />, errorElement: <PageError page="Cheat sheet" /> },
					{ path: "space/mock/:spaceId/:mockId", loader: mockLoader, element: <MockRoute />, errorElement: <PageError page="Mock" /> },
					{ path: "chat/:id", loader: lessonLoader, element: <LessonPage />, errorElement: <PageError page="Lesson" /> },
					{ path: "*", element: <NotFound /> },
				],
			},
		],
	},
];
