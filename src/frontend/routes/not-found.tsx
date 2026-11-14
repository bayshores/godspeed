import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { cn } from "@/frontend/lib/utils";
import { PageTitle } from "./page-title";

/** A removed lesson's or deadline's link, or any unknown address, in the
 *  app's own look. `page` names the window title, as a gone lesson's
 *  ("godspeed / Lesson"). */
export function NotFound({ page }: { page?: string }) {
	return (
		<div className="h-full overflow-y-auto">
			<PageTitle page={page} />
			<div data-testid="not-found" className="mx-auto flex w-[520px] max-w-full flex-col gap-6 px-6 pt-[220px] pb-10">
				<h1 className="text-[30px] leading-tight text-ink">This page doesn&apos;t exist.</h1>
				<div>
					<Link to="/" className={cn("lh-btn lh-btn-main", BIG_BUTTON)}>
						Go to Today
					</Link>
				</div>
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
