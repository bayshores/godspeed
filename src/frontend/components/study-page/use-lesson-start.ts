import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { lessonStop, type ChatAttachment, type DeadlineProgress, type GraphContextPick, type LhMessage } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { holdStartFiles } from "@/frontend/components/lesson/start-files";
import { useWake } from "@/frontend/components/teacher/use-wake";
import { getJson, jsonInit, send } from "@/frontend/lib/api";

const LESSON_START_FAILED = "Couldn't start the lesson. Try again.";

/** What `busyOn` names while the typed-topic start runs. */
export const TYPED_START = "typed";

/** What `busyOn` names while a deadline's homework start runs: its Study
 *  start is the plain deadline id, so the two keys of a deadline differ. */
export const homeworkStartId = (deadlineId: string) => `homework ${deadlineId}`;

/** What a start sends POST /api/chats: a typed topic (its title and any
 *  facts picked for it), some space topics, one question of a mock, a
 *  deadline, a topic of the space's path, or files of the space. On picked
 *  facts with no title, topics, a deadline or files the server picks the
 *  session's topics and writes its title. */
type StartBody =
	| { title: string; graphContext?: { propositions: readonly GraphContextPick[] } }
	| { topicIds: readonly string[] }
	| { mockQuestion: { mockId: string; questionId: string } }
	| { deadlineId: string; homework?: true }
	| { pathTopicId: string }
	| { fileIds: readonly string[] };

/**
 * Every Study start (the start page, its suggestions, a deadline, the
 * Graph, the Overview) goes through here, in the active space. The lesson
 * runs on the outside agent; with no agent connected it waits in the agent
 * queue (the lesson shows "Waiting for Teacher") and, in the desktop
 * app, starts the agent last started there (TerminalsApi.wake). The session's title,
 * as the server returns it, is its first message, with any pictures and
 * PDFs added to the topic. A start that fails sets `error` for the screen
 * to show. `busyOn` is the id of the start in flight (a deadline, topic,
 * path topic, chat or mock question id; topic ids joined by a comma;
 * TYPED_START or `id` for a typed topic), so only the key pressed shows
 * it is working.
 */
export function useLessonStart() {
	const navigate = useNavigate();
	const { active } = useSpaces();
	const [busyOn, setBusyOn] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const wake = useWake();

	const post = useCallback(
		async (startId: string, body: StartBody, files: readonly ChatAttachment[] = [], spaceId = active) => {
			if (busyOn !== null) return;
			setBusyOn(startId);
			setError(null);
			const { error: failed, body: made } = await send("/api/chats", jsonInit("POST", { ...body, ...(spaceId ? { spaceId } : {}) }));
			if (failed) {
				setBusyOn(null);
				setError(LESSON_START_FAILED);
				return;
			}
			const { id, title, continued } = made as { id: string; title: string; continued?: boolean };
			// A lesson on files may go on where it was: it gets no first message.
			if (continued) {
				navigate(`/chat/${encodeURIComponent(id)}`);
				return;
			}
			holdStartFiles(id, files);
			wake?.();
			navigate(`/chat/${id}?prompt=${encodeURIComponent(title)}`);
		},
		[busyOn, active, navigate, wake],
	);

	/** Study a typed topic, with any facts picked for it and any files added,
	 *  or the picked facts alone. `id` names the start in `busyOn` when a key
	 *  other than the topic box's starts it. */
	const start = useCallback(
		(req: { title: string; picks?: readonly GraphContextPick[]; files?: readonly ChatAttachment[]; id?: string }) => {
			const title = req.title.trim();
			const picks = req.picks ?? [];
			if (title || picks.length > 0) return post(req.id ?? TYPED_START, { title, ...(picks.length > 0 ? { graphContext: { propositions: picks } } : {}) }, req.files);
		},
		[post],
	);

	/** Study some of a space's topics, the active space's unless `spaceId` names one (Home). */
	const studyTopics = useCallback(
		(topicIds: readonly string[], spaceId?: string) => {
			if (topicIds.length > 0) return post(topicIds.join(","), { topicIds }, [], spaceId ?? active);
		},
		[post, active],
	);

	/** Study a file: the server goes on in the unfinished lesson on it, or
	 *  starts its deadline's homework when it is the assignment sheet, or a
	 *  new lesson on it. */
	const studyFile = useCallback((fileId: string) => post(fileId, { fileIds: [fileId] }), [post]);

	/** Study one topic of the space's path. */
	const studyPathTopic = useCallback((pathTopicId: string) => post(pathTopicId, { pathTopicId }), [post]);

	/** Go over one question of a graded mock. */
	const goOverMock = useCallback((mockId: string, questionId: string, spaceId: string) => post(questionId, { mockQuestion: { mockId, questionId } }, [], spaceId), [post]);

	/** Study for a deadline: reopens its unfinished session, else starts
	 *  on the next of today's topics that need work. `spaceId`: the
	 *  deadline's space when it isn't the active one (Home). */
	const studyDeadline = useCallback(
		(deadline: Pick<DeadlineProgress, "id" | "continueStudy">, spaceId?: string) => {
			if (deadline.continueStudy) navigate(`/chat/${deadline.continueStudy.chatId}`);
			else return post(deadline.id, { deadlineId: deadline.id }, [], spaceId ?? active);
		},
		[post, navigate, active],
	);

	/** Continue a Study session at its stop: Keep going is stored first, so
	 *  the next topic's opener shows with no agent, then the lesson opens
	 *  with the stop's card lit once. A failed read or store opens it at the
	 *  stop, where Your turn offers its key again. */
	const continueStopped = useCallback(
		async (chatId: string) => {
			if (busyOn !== null) return;
			setBusyOn(chatId);
			const lesson = `/chat/${encodeURIComponent(chatId)}`;
			const { body } = await getJson<{ messages: LhMessage[] }>(`/api/chats/${encodeURIComponent(chatId)}`);
			const stop = body ? lessonStop(body.messages, null) : null;
			const kept = stop && !stop.keptGoing ? await send(`/api/chats/${encodeURIComponent(chatId)}/keep-going`, jsonInit("POST", { input: { stopOf: stop.stopOf } })) : null;
			navigate(kept && !kept.error ? `${lesson}?lit=stop` : lesson);
		},
		[busyOn, navigate],
	);

	/** Work on a homework or project: reopens its latest homework session,
	 *  else starts one on its next problem not done. */
	const workOnHomework = useCallback(
		(deadline: Pick<DeadlineProgress, "id" | "continueHomework">, spaceId?: string) => {
			if (deadline.continueHomework) navigate(`/chat/${deadline.continueHomework}`);
			else return post(homeworkStartId(deadline.id), { deadlineId: deadline.id, homework: true }, [], spaceId ?? active);
		},
		[post, navigate, active],
	);

	return {
		start,
		studyTopics,
		studyFile,
		studyPathTopic,
		goOverMock,
		studyDeadline,
		continueStopped,
		workOnHomework,
		busy: busyOn !== null,
		busyOn,
		error,
	};
}
