import type { Metadata } from "next";
import type { ClassSummary } from "@/shared/core";
import { Atkinson_Hyperlegible_Mono, Martian_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/frontend/components/sidebar";
import { ActivityProvider } from "@/frontend/components/activity-dock";
import { ServerEventsProvider } from "@/frontend/components/server-events";
import { AgentStatusProvider } from "@/frontend/components/agent-status";
import { AppearanceProvider } from "@/frontend/components/settings/appearance";
import UpdateBanner from "@/frontend/components/update-banner";
import { ClassProvider } from "@/frontend/components/class-context";
import { SoundProvider } from "@/frontend/components/sounds";
// The light server door — the @/backend/server barrel would load the whole server
// (agent engine, MCP, extraction) just for these render-time reads.
import { classStore, firstLoadScreen, folderNoticeAgent, onboardingNeeded, readSettingsRecord, refreshAgentFolder, whatsNewSince } from "@/backend/server/settings-read";
import { Onboarding } from "@/frontend/components/onboarding/onboarding";
import { RestartNotice } from "@/frontend/components/restart-notice";
import { NoticeStack } from "@/frontend/components/notice-stack";
import { WhatsNew } from "@/frontend/components/whats-new";
import { FolderNotice } from "@/frontend/components/agent-folder/folder-notice";
import { OldSetupNotice } from "@/frontend/components/agent-folder/old-setup";

// The interface is Martian Mono, reading text Atkinson Hyperlegible Mono.
// next/font bundles both at build time, so they work offline.
const ui = Martian_Mono({ subsets: ["latin"], variable: "--font-martian" });
const prose = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--font-atkinson" });

// Request-time render: the active class is read
// from the live settings record on every load, never baked in at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	// Each page names itself ("Graph · godspeed"); Home keeps the plain name.
	title: { template: "%s · godspeed", default: "godspeed" },
	description: "A teacher agent with a memory: lessons, quizzes, and a knowledge graph of what you know.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	// The active class renders server-side so the
	// first paint already shows the right class's lessons and graph.
	let initialActive: string | null = null;
	// The class list too, so the first paint shows the class (not "No class").
	let initialClasses: ClassSummary[] | undefined;
	// Halley's name (Settings → General), so the first paint has it.
	let teacherName: string | undefined;
	let soundsOn = true;
	// First launch: the onboarding replaces the app
	// shell until it is finished. Deciding also makes the outside-agent
	// access token (always on), so the godspeed folder's connector can find it.
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
	// The godspeed folder: its files follow this version, and people set up
	// the old way (the plugin, the Codex config) are asked to move once,
	// after the welcome screen, on a launch without "What's new".
	refreshAgentFolder();
	let folderNotice: ReturnType<typeof folderNoticeAgent> = null;
	try {
		folderNotice = !onboarding && !whatsNew ? folderNoticeAgent() : null;
	} catch {
		/* unreadable data dir: ask next launch */
	}
	// Asked even during onboarding, so finishing it doesn't open the welcome
	// screen right after "You're all set".
	const firstLoad = firstLoadScreen();
	const welcome = firstLoad === "welcome" && !onboarding;
	try {
		const general = readSettingsRecord()?.general;
		const raw = general?.activeClass;
		// A class deleted behind the app's back falls back to No class.
		initialActive = raw && raw !== "none" && classStore.getClass(raw) ? raw : null;
		initialClasses = classStore.listClasses();
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
				<ClassProvider initialActive={initialActive} initialClasses={initialClasses}>
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
			{/* Auto-update banner (Electron-only pushes) and the restart notice. */}
			<NoticeStack>
				<UpdateBanner />
				{firstLoad === "restarted" && <RestartNotice />}
				{!onboarding && <OldSetupNotice />}
			</NoticeStack>
			{/* "What's new" after an update (after the welcome screen when it
			    shows); Settings reopens it. */}
			{!onboarding && <WhatsNew since={welcome ? null : whatsNew} />}
			{folderNotice && <FolderNotice agent={folderNotice} afterWelcome={welcome} />}
		</body>
		</html>
	);
}
