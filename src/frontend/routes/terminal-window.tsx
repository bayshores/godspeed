import { useBoot } from "@/frontend/components/boot";
import { TerminalWindow } from "@/frontend/components/terminal/terminal-window";
import { AppProviders } from "./app-providers";

/** The terminal window's page: the providers every window has, and no app frame. */
export function TerminalWindowRoute() {
	const { boot } = useBoot();
	return (
		<AppProviders boot={boot} inTerminalWindow>
			<title>godspeed</title>
			<TerminalWindow />
		</AppProviders>
	);
}
