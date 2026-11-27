/** The teacher's state, as the provider (teacher-provider.tsx) shares it. In
 *  its own file so parts the provider draws can read it without an import
 *  cycle. */
import { createContext, useContext } from "react";
import type { AgentAction, TalkChat } from "@/shared/core";
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
	/** Open the panel on its chat, or on chat `id` (null: a new chat), or bring the chat's own
	 *  window forward while it is popped out. */
	showChat: (id?: string | null) => void;
	/** The panel's chats, newest first (null before the first read), and the one it shows (null:
	 *  a new chat). */
	talk: { chats: readonly TalkChat[] | null; chatId: string | null };
	/** The chats whose teacher waits for the learner to allow something, oldest first: the
	 *  lessons', and the panel chat's first. */
	waiting: { lessons: readonly string[]; talk: string | null };
	/** The teacher can be handed a line by a page key (ask): not while its chat is popped out. */
	canAsk: boolean;
	/** A page key hands the teacher one line: the panel opens on its chat and sends it as if typed.
	 *  A second line replaces one not yet sent. */
	ask: (line: string) => void;
	/** The line waiting to be sent (ask), which the panel's chat takes; `clear` once it has. */
	asking: { line: string; clear: () => void } | null;
	/** Newest first. */
	recent: AgentAction[];
	/** What the agent is doing now; null before the first read of the agent. */
	doing: AgentDoing | null;
	/** The agent works on anything, a reply in one of the panel's chats too. */
	working: boolean;
	/** It works on something besides the chat the panel shows, whose own thread shows that chat's work. */
	elsewhere: boolean;
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
