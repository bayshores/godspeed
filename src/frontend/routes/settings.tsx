import { useSearchParams } from "react-router";
import { SettingsPage } from "@/frontend/components/settings/settings-page";
import { PageTitle } from "./page-title";

/** Settings ("/settings"); "?section=teaching" opens on that tab. */
export function SettingsRoute() {
	const [params] = useSearchParams();
	return (
		<>
			<PageTitle page="Settings" />
			<SettingsPage section={params.get("section") ?? undefined} />
		</>
	);
}
