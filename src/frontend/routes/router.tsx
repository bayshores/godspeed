import { createBrowserRouter } from "react-router";
import { HomePage } from "@/frontend/components/home-page/home-page";
import { NewLesson } from "@/frontend/components/home";
import { GraphScreen } from "@/frontend/components/graph/graph-screen";
import { ClassOverview } from "@/frontend/components/overview/class-overview";
import { FilesPage } from "@/frontend/components/files/files-page";
import { ClassSheetsPage } from "@/frontend/components/cheat-sheet/class-sheets";
import { Root } from "./root";
import { NotFound, PageError } from "./not-found";
import { PageTitle } from "./page-title";
import { LessonPage, lessonLoader } from "./lesson";
import { CheatSheetRoute, DeadlineRoute, deadlineLoader } from "./deadline";

/** Every screen. A page that needs data first (a lesson, a deadline) has a
 *  loader: a navigation keeps the old page until it is read, and one that
 *  is gone shows NotFound inside the app frame. */
export const router = createBrowserRouter([
	{
		element: <Root />,
		children: [
			{
				errorElement: <PageError />,
				children: [
					// Home: what's coming up across every class, and one block per class.
					{ index: true, element: <><PageTitle /><HomePage /></> },
					// The start page: every new lesson is a study session.
					{ path: "new", element: <><PageTitle page="study" /><NewLesson /></> },
					{ path: "graph", element: <><PageTitle page="graph" /><GraphScreen /></> },
					{ path: "class", element: <><PageTitle page="overview" /><ClassOverview /></> },
					{ path: "class/files", element: <><PageTitle page="files" /><FilesPage /></> },
					{ path: "class/cheat-sheets", element: <><PageTitle page="cheat sheets" /><ClassSheetsPage /></> },
					{ path: "class/deadline/:id", loader: deadlineLoader, element: <DeadlineRoute />, errorElement: <PageError page="deadline" /> },
					{ path: "class/deadline/:id/cheat-sheet", loader: deadlineLoader, element: <CheatSheetRoute />, errorElement: <PageError page="cheat sheet" /> },
					{ path: "chat/:id", loader: lessonLoader, element: <LessonPage />, errorElement: <PageError page="lesson" /> },
					{ path: "*", element: <NotFound /> },
				],
			},
		],
	},
]);
