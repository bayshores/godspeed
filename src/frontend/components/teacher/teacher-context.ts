/** The teacher's state, as the provider (teacher-provider.tsx) shares it. In
 *  its own file so parts the provider draws can read it without an import
 *  cycle. */
import { createContext, useContext } from "react";
import type { AgentAction } from "@/shared/core";
import type { AgentDoing } from "./follow-status";
import type { FollowSlip } from "./use-follow-slip";

export interface LessonPresence {
	/** A turn is in flight. */
	working: boolean;
	/** The learner has unsent text here: Follow stays on this lesson. */
	draft: boolean;
}

export interface TeacherApi {
	name: string;
	follow: boolean;
	setFollow: (on: boolean) => void;
	panelOpen: boolean;
	setPanelOpen: (open: boolean) => void;
	/** Open the panel on the teacher's screen, which takes the keyboard (or bring its own
	 *  window forward while it is popped out). */
	showTerminal: () => void;
	/** The teacher can be handed a line by a page key (ask): godspeed runs it in its own
	 *  terminal here, so not in a browser, with an outside agent or popped out. */
	canAsk: boolean;
	/** A page key hands the teacher one line: the panel opens on its screen and sends it once the
	 *  teacher can take it. A second line replaces one not yet sent. */
	ask: (line: string) => void;
	/** The line waiting to be sent (ask), which the panel's screen takes; `clear` once it has. */
	asking: { line: string; clear: () => void } | null;
	/** Newest first. */
	recent: AgentAction[];
	/** What the agent is doing now; null before the first read of the agent. */
	doing: AgentDoing | null;
	/** A lesson screen reports itself (null when it leaves). */
	setLesson: (p: LessonPresence | null) => void;
	/** Go to a change (the peek's or the slip's "Go to", a row of the slip's list): its page now,
	 *  whatever Follow waits for, then its item lit. */
	go: (action: AgentAction) => void;
	/** Follow's slip at the page's foot while the teacher works; null while it does not show. */
	slip: FollowSlip | null;
	/** What "Go to" offers: a page the agent opened while the window held,
	 *  else with Follow off a fresh change on another page. */
	offer: AgentAction | null;
	/** The offer is a held open, shown with Follow on too. */
	held: boolean;
	/** A space's name by id (Recent rows name the space). */
	spaceNameOf: (id: string | null) => string | null;
}

export const TeacherContext = createContext<TeacherApi | null>(null);

/** The teacher's state; null outside the app shell (render tests, onboarding). */
export function useTeacher(): TeacherApi | null {
	return useContext(TeacherContext);
}
