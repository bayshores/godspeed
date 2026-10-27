/**
 * THE CLASS CARD (classes wave, owner-approved 2026-10-26, Phase 4): the
 * short [Class context] message a lesson in a class opens with — class
 * name, the learner's description, and the class files with paths the
 * teacher can open (text with `read`, PDFs with the pdf job). It is a
 * snapshot from when the lesson started; the read_class tool gives the
 * current version.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ClassRecord } from "../core/contracts.ts";
import { isRecordingFile } from "../core/contracts.ts";
import { newClassContextMessage, type ClassCardDetails, type LhMessage } from "../core/native-messages.ts";
import { stores } from "./stores.ts";

function absolutePath(record: ClassRecord, file: ClassRecord["files"][number]): string | null {
	if (file.origin === "copied") return path.join(stores.classStore.filesDir(record.id), file.path);
	return record.linkedFolder ? path.join(record.linkedFolder, file.path) : null;
}

/** The card's data for a class as it stands now. A recording is listed by
 *  its transcript (once made); unreadable files are listed without a path. */
export function classCardFor(record: ClassRecord): ClassCardDetails {
	return {
		classId: record.id,
		name: record.name,
		description: record.description,
		files: record.files.map((file) => {
			let p = absolutePath(record, file);
			if (p && isRecordingFile(file.name)) {
				const transcript = path.join(stores.classStore.filesDir(record.id), "transcripts", `${file.id}.txt`);
				p = fs.existsSync(transcript) ? transcript : null;
			}
			return { name: file.name, kind: file.kind, path: p };
		}),
	};
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
