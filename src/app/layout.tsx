import type { Metadata } from "next";
import type { AppearanceSettings, ClassSummary } from "@/shared/core";
import { DotGothic16, Literata, Zen_Kaku_Gothic_New } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ElectronEnv } from "@/frontend/components/electron-env";
import { AppShell } from "@/frontend/components/app-shell";
import { ActivityProvider } from "@/frontend/components/activity-dock";
import { ServerEventsProvider } from "@/frontend/components/server-events";
import { AgentStatusProvider } from "@/frontend/components/agent-status";
import { AppearanceProvider } from "@/frontend/components/settings/appearance";
import { appearanceVars, resolveAppearance } from "@/frontend/components/settings/appearance-model";
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

// The interface is Zen Kaku Gothic New, reading text Literata, dates and
// counts DotGothic16. next/font bundles them at build time, so they work offline.
const ui = Zen_Kaku_Gothic_New({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-zen" });
const prose = Literata({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-literata" });
const count = DotGothic16({ subsets: ["latin"], weight: "400", variable: "--font-dot" });

// Request-time render: the active class is read
// from the live settings record on every load, never baked in at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	// Each page names itself ("godspeed / Graph"); Today keeps the plain name.
	title: { template: "godspeed / %s", default: "godspeed" },
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
	// The saved look, so the first paint already has its colors.
	let appearance: AppearanceSettings | undefined;
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
		const record = readSettingsRecord();
		const general = record?.general;
		appearance = record?.appearance;
		const raw = general?.activeClass;
		// A class deleted behind the app's back falls back to No class.
		initialActive = raw && raw !== "none" && classStore.getClass(raw) ? raw : null;
		initialClasses = classStore.listClasses();
		teacherName = general?.teacherName;
		soundsOn = general?.sounds !== false;
	} catch {
		/* unreadable settings: No class */
	}
	const look = resolveAppearance(appearance);
	return (
		<html
			lang="en"
			className={`${look.background === null ? "" : "dark "}${ui.variable} ${prose.variable} ${count.variable}`}
			style={appearanceVars(look) as React.CSSProperties}
		>
			<body className="min-h-dvh antialiased">
			<ElectronEnv />
			{/* The notification channel rides OUTSIDE everything: the top bar,
				 dock and pages all subscribe. */}
			<ServerEventsProvider>
				<AgentStatusProvider>
				<ClassProvider initialActive={initialActive} initialClasses={initialClasses}>
				<AppearanceProvider initial={appearance}>
					<div className="flex h-dvh flex-col">
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
					</div>
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
