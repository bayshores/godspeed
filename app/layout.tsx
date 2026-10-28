import type { Metadata } from "next";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { ClassProvider } from "@/components/class-context";
// The settings store alone — the @/src/server barrel would load the whole
// server (agent engine, MCP, extraction) just to read one field.
import { readSettingsRecord } from "@/src/server/settings-read";

// Chrome = JetBrains Mono, teaching prose = Source Sans 3, titles = CMU
// Serif (the bundled lh-cmu @font-face in globals.css — no CDN).
const ui = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

// Request-time render (classes wave, 2026-10-26): the active class is read
// from the live settings record on every load, never baked in at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "godspeed",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	// The active class (classes wave, 2026-10-26) renders server-side so the
	// first paint already shows the right class's lessons and graph.
	let initialActive: string | null = null;
	try {
		const raw = readSettingsRecord()?.general?.activeClass;
		initialActive = raw && raw !== "none" ? raw : null;
	} catch {
		/* unreadable settings: No class */
	}
	return (
		<html lang="en" className={`dark ${ui.variable} ${prose.variable}`}>
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<ClassProvider initialActive={initialActive}>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
							<AppShell>{children}</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
				</ClassProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
		</body>
		</html>
	);
}
