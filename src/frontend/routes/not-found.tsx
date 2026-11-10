import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { TopBar } from "@/frontend/components/app-bar";
import { PageTitle } from "./page-title";

/** A removed lesson's or deadline's link, or any unknown address, in the
 *  app's own look. `page` names the window title, as a gone lesson's
 *  ("godspeed / lesson"). */
export function NotFound({ page }: { page?: string }) {
	return (
		<div className="flex h-full flex-col">
			<PageTitle page={page} />
			<TopBar inClass={false} path={[{ label: "not-found", href: null }]} />
			<div data-testid="not-found" className="flex flex-col items-start gap-3 px-[52px] py-6">
				<p className="text-base text-ink-2">This page isn&apos;t here anymore. It may have been removed.</p>
				<Link to="/" className="lh-press bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2">
					Go Home
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
