import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { MAIN_KEY } from "@/frontend/components/ui/big-key";
import { PageTitle } from "./page-title";

/** A removed lesson's or deadline's link, or any unknown address, in the
 *  app's own look. `page` names the window title, as a gone lesson's
 *  ("godspeed / Lesson"). */
export function NotFound({ page }: { page?: string }) {
	return (
		<div className="h-full overflow-y-auto">
			<PageTitle page={page} />
			<div data-testid="not-found" className="flex flex-col items-center gap-6 px-6 pt-[220px] pb-10 text-center">
				<h1 className="lh-page-title">This page doesn&apos;t exist.</h1>
				<Link to="/" className={`lh-btn ${MAIN_KEY}`}>
					Go to Home
				</Link>
			</div>
		</div>
	);
}

/** A page whose loader failed: gone (404) shows NotFound; anything else is
 *  a real failure and goes to the console too. */
export function PageError({ page }: { page?: string }) {
	const error = useRouteError();
	if (!isRouteErrorResponse(error) || error.status !== 404) console.error(error);
	return <NotFound page={page} />;
}
