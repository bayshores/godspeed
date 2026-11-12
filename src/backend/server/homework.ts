/**
 * Homework sessions on the server: a new one opens with the space card
 * and a note on the deadline, its assignment file and its problems
 * (core/homework.ts); its tools read and write the deadline's problems
 * through the space store.
 */
import type { ChatRecord, HomeworkProblem } from "../../shared/core/contracts.ts";
import { hasProblems, homeworkContextText, mergeProblems, type HomeworkView } from "../../shared/core/homework.ts";
import { newSpaceContextMessage, newStudyContextMessage, type LhMessage } from "../../shared/core/native-messages.ts";
import type { HomeworkDeadline } from "../agent/tools/homework.ts";
import { spaceCardFor, spaceFilePath } from "./space-card.ts";
import { updateSpaceDeadline } from "./spaces.ts";
import { stores } from "./stores.ts";

type CreateHomeworkOutcome =
	| { ok: true; chat: ChatRecord; title: string }
	| { ok: false; status: 404; code: "space_not_found" | "deadline_not_found"; error: string };

/** Start a homework session on one homework or project deadline. Its title
 *  is the learner's first message. */
export function createHomework(spaceId: string, deadlineId: string): CreateHomeworkOutcome {
	const space = stores.spaceStore.getSpace(spaceId);
	if (!space) return { ok: false, status: 404, code: "space_not_found", error: "No such space" };
	const deadline = (space.deadlines ?? []).find((d) => d.id === deadlineId);
	if (!deadline || !hasProblems(deadline.kind)) return { ok: false, status: 404, code: "deadline_not_found", error: "No such homework or project" };
	const file = deadline.assignmentFileId ? space.files.find((f) => f.id === deadline.assignmentFileId) : undefined;
	const assignment = file ? { id: file.id, name: file.name, path: spaceFilePath(space, file) } : null;
	const title = `Work on ${deadline.name}`;
	const chat = stores.chatStore.createChat(title, "homework", space.id, deadline.id);
	const messages: LhMessage[] = [
		newSpaceContextMessage(spaceCardFor(space)) as LhMessage,
		newStudyContextMessage(homeworkContextText(space.id, deadline, assignment, deadline.problems ?? []), "homework-context") as LhMessage,
	];
	stores.chatStore.saveMessages(chat.id, messages);
	return { ok: true, chat: stores.chatStore.getChat(chat.id) ?? chat, title };
}

/** What a homework lesson shows of its deadline; null once it is gone. */
export function homeworkView(spaceId: string, deadlineId: string): HomeworkView | null {
	const space = stores.spaceStore.getSpace(spaceId);
	const deadline = space?.deadlines?.find((d) => d.id === deadlineId);
	if (!space || !deadline) return null;
	const file = deadline.assignmentFileId ? space.files.find((f) => f.id === deadline.assignmentFileId) : undefined;
	return { name: deadline.name, problems: deadline.problems ?? [], assignment: file ? { name: file.name, path: spaceFilePath(space, file) } : null };
}

/** The homework tools' view of one deadline. */
export function homeworkDeadline(spaceId: string, deadlineId: string): HomeworkDeadline {
	const problems = (): readonly HomeworkProblem[] => stores.spaceStore.getSpace(spaceId)?.deadlines?.find((d) => d.id === deadlineId)?.problems ?? [];
	const save = (next: HomeworkProblem[]): string | null => {
		const outcome = updateSpaceDeadline(spaceId, deadlineId, { problems: next });
		return outcome.ok ? null : outcome.error;
	};
	return {
		problems,
		post: (posted) => save(mergeProblems(problems(), posted)),
		markDone: (number) => void save(problems().map((p) => (p.number === number ? { ...p, done: true } : p))),
	};
}
