/**
 * THE SPACE CARD: the short [Space context] message a lesson in a space
 * opens with — space name, the learner's description, the space files
 * (size, state, and the path the teacher can open) and the topics of the
 * space's graph with their fact counts. It is a snapshot from when the
 * lesson started; the read_space tool gives the current version.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SpaceFile, SpaceRecord } from "../../shared/core/contracts.ts";
import { isRecordingFile } from "../../shared/core/contracts.ts";
import { getGraph } from "../../shared/core/graph.ts";
import { newSpaceContextMessage, type SpaceCardDetails, type LhMessage } from "../../shared/core/native-messages.ts";
import { resolveTopics } from "../../shared/core/topics.ts";
import { fileExtents } from "./search-index.ts";
import { graphStoreFor, stores } from "./stores.ts";

/** Absolute path of a space file on this computer (null when its linked
 *  folder is gone). */
export function spaceFilePath(record: SpaceRecord, file: SpaceFile): string | null {
	if (file.origin === "copied") return path.join(stores.spaceStore.filesDir(record.id), file.path);
	return record.linkedFolder ? path.join(record.linkedFolder, file.path) : null;
}

/** Where a recording's transcript is kept (inside the app's own space
 *  folder, a linked folder is never written to). */
export function transcriptPathOf(spaceId: string, fileId: string): string {
	return path.join(stores.spaceStore.filesDir(spaceId), "transcripts", `${fileId}.txt`);
}

/** The card's data for a space as it stands now. A recording is listed by
 *  its transcript (its lecture's transcript file, or the one made from
 *  it); unreadable files are listed without a path. */
export function spaceCardFor(record: SpaceRecord): SpaceCardDetails {
	const sizes = fileExtents(record.id);
	const topics = spaceTopics(record.id);
	return {
		spaceId: record.id,
		name: record.name,
		description: record.description,
		files: record.files.map((file) => {
			let p = spaceFilePath(record, file);
			const covering = file.transcriptId ? record.files.find((f) => f.id === file.transcriptId) : undefined;
			if (covering) {
				p = spaceFilePath(record, covering);
			} else if (p && isRecordingFile(file.name)) {
				const transcript = transcriptPathOf(record.id, file.id);
				p = fs.existsSync(transcript) ? transcript : null;
			}
			return { name: file.name, kind: file.kind, path: p, ...(sizes[file.id] ? { size: sizes[file.id] } : {}), status: file.status };
		}),
		...(topics.length ? { topics } : {}),
	};
}

/** The space graph's topics with how many facts each holds. */
export function spaceTopics(spaceId: string): { name: string; facts: number }[] {
	const store = graphStoreFor(spaceId);
	const factIds = getGraph(store).nodes.map((n) => n.id);
	return resolveTopics(store.readTopics(), factIds).map((t) => ({ name: t.name, facts: t.members.length }));
}

/** Put (or replace, or remove) a lesson's space card: the first
 *  space-context marker is swapped for the new space's card; with no space
 *  it is dropped; a lesson without one gets it as its first message. */
export function applySpaceCard(chatId: string, record: SpaceRecord | null): void {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) return;
	const at = chat.messages.findIndex((m) => m.role === "custom" && m.customType === "space-context");
	const card = record ? (newSpaceContextMessage(spaceCardFor(record)) as LhMessage) : null;
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
