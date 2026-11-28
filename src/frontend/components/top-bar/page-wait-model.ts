/** The page a click is opening while its loader reads it. Pure. */
import type { Location } from "react-router";

/** The page the router is reading before it shows it (`useNavigation()`), or null: none is, or the
 *  read is of the page already shown (its search changed, so its loader runs again where it stands). */
export function pageBeingRead(navigation: { state: string; location?: Location }, shown: string): Location | null {
	return navigation.state === "loading" && navigation.location && navigation.location.pathname !== shown ? navigation.location : null;
}

/** The page a link's href leads to. */
export function hrefPage(href: string): string {
	return href.replace(/[?#].*$/, "");
}
