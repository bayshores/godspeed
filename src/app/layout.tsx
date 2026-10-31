import type { Metadata } from "next";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AgentStatusProvider } from "@/components/agent-status";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import { ClassProvider } from "@/components/class-context";
import { SoundProvider } from "@/components/sounds";
// The light server door — the @/server barrel would load the whole server
// (agent engine, MCP, extraction) just for these two render-time reads.
import { firstLoadScreen, onboardingNeeded, readSettingsRecord, whatsNewSince } from "@/server/settings-read";
import { Onboarding } from "@/components/onboarding/onboarding";
import { RestartNotice } from "@/components/restart-notice";
import { WhatsNew } from "@/components/whats-new";

// Chrome = JetBrains Mono, teaching prose = Source Sans 3, titles = CMU
// Serif (the bundled lh-cmu @font-face in globals.css — no CDN).
const ui = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

// Request-time render: the active class is read
// from the live settings record on every load, never baked in at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "godspeed",
	description: "A teacher agent with a memory: lessons, quizzes, and a knowledge graph of what you know.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	// The active class renders server-side so the
	// first paint already shows the right class's lessons and graph.
	let initialActive: string | null = null;
	// Halley's name (Settings → General), so the first paint has it.
	let teacherName: string | undefined;
	let soundsOn = true;
	// First launch: the onboarding replaces the app
	// shell until it is finished. Deciding also makes the outside-agent
	// access token (always on), so the Claude Code plugin can find it.
	let onboarding = false;
	try {
		onboarding = onboardingNeeded();
	} catch {
		/* unwritable data dir: show the app; /api/mcp retries the token */
	}
	// After an update: the versions whose notes the
	// learner hasn't seen. Decided after onboarding, which marks existing users.
	let whatsNew: string | null = null;
	try {
		whatsNew = whatsNewSince();
	} catch {
		/* unwritable data dir: skip the notes this launch */
	}
	// Asked even during onboarding, so finishing it doesn't open the welcome
	// screen right after "You're all set".
	const firstLoad = firstLoadScreen();
	const welcome = firstLoad === "welcome" && !onboarding;
	try {
		const general = readSettingsRecord()?.general;
		const raw = general?.activeClass;
		initialActive = raw && raw !== "none" ? raw : null;
		teacherName = general?.teacherName;
		soundsOn = general?.sounds !== false;
	} catch {
		/* unreadable settings: No class */
	}
	return (
		<html lang="en" className={`dark ${ui.variable} ${prose.variable}`}>
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe. */}
			<ServerEventsProvider>
				<AgentStatusProvider>
				<ClassProvider initialActive={initialActive}>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
						<SoundProvider initialOn={soundsOn}>
							{onboarding ? (
								<Onboarding />
							) : (
								<AppShell teacherName={teacherName} welcome={welcome} whatsNewSince={welcome ? whatsNew : null}>
									{children}
								</AppShell>
							)}
						</SoundProvider>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
				</ClassProvider>
				</AgentStatusProvider>
			</ServerEventsProvider>
			{/* Auto-update banner: fixed card, Electron-only pushes. */}
			<UpdateBanner />
			{firstLoad === "restarted" && <RestartNotice />}
			{/* "What's new" after an update (after the welcome screen when it
			    shows); Settings reopens it. */}
			{!onboarding && <WhatsNew since={welcome ? null : whatsNew} />}
		</body>
		</html>
	);
}
