/**
 * THE CLASS CARD: the short [Class context] message a lesson in a class
 * opens with — class name, the learner's description, the class files
 * (size, state, and the path the teacher can open) and the topics of the
 * class's graph with their fact counts. It is a snapshot from when the
 * lesson started; the read_class tool gives the current version.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ClassFile, ClassRecord } from "../core/contracts.ts";
import { isRecordingFile } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import { newClassContextMessage, type ClassCardDetails, type LhMessage } from "../core/native-messages.ts";
import { resolveTopics } from "../core/topics.ts";
import { fileExtents } from "./search-index.ts";
import { graphStoreFor, stores } from "./stores.ts";

/** Absolute path of a class file on this computer (null when its linked
 *  folder is gone). */
export function classFilePath(record: ClassRecord, file: ClassFile): string | null {
	if (file.origin === "copied") return path.join(stores.classStore.filesDir(record.id), file.path);
	return record.linkedFolder ? path.join(record.linkedFolder, file.path) : null;
}

/** Where a recording's transcript is kept (inside the app's own class
 *  folder, a linked folder is never written to). */
export function transcriptPathOf(classId: string, fileId: string): string {
	return path.join(stores.classStore.filesDir(classId), "transcripts", `${fileId}.txt`);
}

/** The card's data for a class as it stands now. A recording is listed by
 *  its transcript (once made); unreadable files are listed without a path. */
export function classCardFor(record: ClassRecord): ClassCardDetails {
	const sizes = fileExtents(record.id);
	const topics = classTopics(record.id);
	return {
		classId: record.id,
		name: record.name,
		description: record.description,
		files: record.files.map((file) => {
			let p = classFilePath(record, file);
			if (p && isRecordingFile(file.name)) {
				const transcript = transcriptPathOf(record.id, file.id);
				p = fs.existsSync(transcript) ? transcript : null;
			}
			return { name: file.name, kind: file.kind, path: p, ...(sizes[file.id] ? { size: sizes[file.id] } : {}), status: file.status };
		}),
		...(topics.length ? { topics } : {}),
	};
}

/** The class graph's topics with how many facts each holds. */
export function classTopics(classId: string): { name: string; facts: number }[] {
	const store = graphStoreFor(classId);
	const factIds = getGraph(store).nodes.map((n) => n.id);
	return resolveTopics(store.readTopics(), factIds).map((t) => ({ name: t.name, facts: t.members.length }));
}

/** Put (or replace, or remove) a lesson's class card: the first
 *  class-context marker is swapped for the new class's card; with no class
 *  it is dropped; a lesson without one gets it as its first message. */
export function applyClassCard(chatId: string, record: ClassRecord | null): void {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return;
	const at = chat.messages.findIndex((m) => m.role === "custom" && m.customType === "class-context");
	const card = record ? (newClassContextMessage(classCardFor(record)) as LhMessage) : null;
	const messages = [...chat.messages];
	if (at >= 0) {
		if (card) messages[at] = { ...card, id: messages[at]!.id };
		else messages.splice(at, 1);
	} else if (card) {
		messages.unshift(card);
	} else {
		return;
	}
	stores.chatStore.saveMessages(chatId, messages);
}
