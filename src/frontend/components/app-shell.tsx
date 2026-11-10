import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";
import { KeyboardShortcuts } from "@/frontend/components/keyboard-shortcuts";
import { SettingsDialogProvider } from "@/frontend/components/settings/settings-dialog-provider.tsx";
import { RuleNotice } from "@/frontend/components/rule-notice";
import { FilesNotice } from "@/frontend/components/files-notice";
import { QuietNotice } from "@/frontend/components/quiet-notice";
import { replayRise } from "@/frontend/components/sidebar/motion";
import { OpenDeadlinesProvider } from "@/frontend/components/use-open-deadlines";
import { HalleyProvider } from "@/frontend/components/halley/halley-provider";
import { Welcome } from "@/frontend/components/welcome/welcome";
import { SessionsSidebar } from "@/frontend/components/sidebar";
import { AppBar, WithAppBar } from "@/frontend/components/app-bar";

/** The view swap: switching between pages (Home, a lesson, Overview…)
 *  rises the incoming page in once. */
function ViewSwap({ children }: { children: React.ReactNode }) {
	const { pathname } = useLocation();
	const ref = useRef<HTMLDivElement>(null);
	const prev = useRef(pathname);
	useLayoutEffect(() => {
		const from = prev.current;
		prev.current = pathname;
		if (from === pathname) return;
		replayRise(ref.current);
	}, [pathname]);
	return (
		<div ref={ref} className="h-full" style={{ animationDuration: "var(--lh-dur-slow)" }}>
			{children}
		</div>
	);
}

/** The app frame: the top bar over the sidebar and the page, and the
 *  welcome screen over everything at launch. Rendered once by
 *  src/frontend/routes/root.tsx. */
export function AppShell({
	children,
	teacherName,
	welcome,
	whatsNewSince,
}: {
	children: React.ReactNode;
	teacherName?: string;
	welcome: boolean;
	whatsNewSince: string | null;
}) {
	return (
		<SettingsDialogProvider>
			<OpenDeadlinesProvider>
				<Welcome initialOpen={welcome} whatsNewSince={whatsNewSince} />
				<HalleyProvider initialName={teacherName}>
					<a href="#lh-page" className="lh-btn sr-only focus:not-sr-only focus:fixed focus:top-1.5 focus:left-1.5 focus:z-50 focus:bg-card">
						Skip to the page
					</a>
					<AppBar />
					<div className="flex min-h-0 flex-1">
						<SessionsSidebar />
						{/* The teacher's open panel pushes the page left (halley-panel.tsx sets the var). */}
						<main id="lh-page" tabIndex={-1} className="min-w-0 flex-1 pr-(--lh-dock-push,0px) motion-safe:transition-[padding] motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)">
							<WithAppBar>
								<ViewSwap>{children}</ViewSwap>
							</WithAppBar>
						</main>
					</div>
				</HalleyProvider>
			</OpenDeadlinesProvider>
			{/* The single document-level keydown listener: window-level, so its
			    place in the tree only matters for the events it dispatches. */}
			<KeyboardShortcuts />
			<RuleNotice />
			<FilesNotice />
			<QuietNotice />
		</SettingsDialogProvider>
	);
}
