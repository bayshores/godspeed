import type { RouteObject } from "react-router";
import { HomePage } from "@/frontend/components/home-page/home-page";
import { NewLesson } from "@/frontend/components/study-page";
import { GraphScreen } from "@/frontend/components/graph/graph-screen";
import { SpaceOverview } from "@/frontend/components/overview/space-overview";
import { FilesPage } from "@/frontend/components/files/files-page";
import { DeadlinesTab } from "@/frontend/components/space-page/deadlines-tab";
import { Root } from "./root";
import { NotFound, PageError } from "./not-found";
import { PageTitle } from "./page-title";
import { SpaceLayout } from "./space-layout";
import { SettingsRoute } from "./settings";
import { LessonPage, lessonLoader } from "./lesson";
import { CheatSheetRoute, DeadlineRoute, deadlineLoader } from "./deadline";
import { MockRoute, mockLoader } from "./mock";
import { PluginTab } from "./plugin-tab";
import { TerminalWindowRoute } from "./terminal-window";

/** Every screen. A page that needs data first (a lesson, a deadline, a
 *  mock) has a loader: a navigation keeps the old page until it is read,
 *  and one that is gone shows NotFound inside the app frame. */
export const routes: RouteObject[] = [
	// The teacher's terminal in a window of its own: no app frame around it.
	{ path: "terminal-window", element: <TerminalWindowRoute /> },
	{
		element: <Root />,
		children: [
			{
				errorElement: <PageError />,
				children: [
					// Home: what's coming up across every space, and one block per space.
					{ index: true, element: <><PageTitle /><HomePage /></> },
					// The start page: every new lesson is a study session.
					{ path: "new", element: <><PageTitle page="Study" /><NewLesson /></> },
					{ path: "settings", element: <SettingsRoute /> },
					{
						element: <SpaceLayout />,
						children: [
							{ path: "graph", element: <><PageTitle page="Graph" /><GraphScreen /></> },
							{ path: "space", element: <><PageTitle page="Progress" /><SpaceOverview /></> },
							{ path: "space/files", element: <><PageTitle page="Files" /><FilesPage /></> },
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
							{ path: "space/plugin/:id", element: <PluginTab /> },
						],
					},
					{ path: "space/deadline/:id", loader: deadlineLoader, element: <DeadlineRoute />, errorElement: <PageError page="Deadline" /> },
					{ path: "space/deadline/:id/cheat-sheet", loader: deadlineLoader, element: <CheatSheetRoute />, errorElement: <PageError page="Cheat sheet" /> },
					{ path: "space/mock/:spaceId/:mockId", loader: mockLoader, element: <MockRoute />, errorElement: <PageError page="Mock" /> },
					{ id: "lesson", path: "chat/:id", loader: lessonLoader, element: <LessonPage />, errorElement: <PageError page="Lesson" /> },
					{ path: "*", element: <NotFound /> },
				],
			},
		],
	},
];
