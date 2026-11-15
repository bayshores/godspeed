import type { ChatListItem, GraphSnapshot } from "@/shared/core";
import { jsonInit, send } from "./api";

/** A server answer for a plugin's frame: the value, or why there is none. */
export type HostAnswer = { error: string } | { error: null; value: unknown };

const pluginUrl = (id: string, rest: string) => `/api/plugins/${encodeURIComponent(id)}/${rest}`;

async function answer(request: Promise<{ error: string | null; body: unknown }>, field: string): Promise<HostAnswer> {
	const { error, body } = await request;
	return error ? { error } : { error: null, value: (body as Record<string, unknown>)[field] ?? null };
}

/** The JSON the plugin stored under `key`; null when nothing is. */
export function readStored(id: string, key: string): Promise<HostAnswer> {
	return answer(send(pluginUrl(id, `storage/${encodeURIComponent(key)}`), { method: "GET" }), "value");
}

export function writeStored(id: string, key: string, value: unknown): Promise<HostAnswer> {
	return answer(send(pluginUrl(id, `storage/${encodeURIComponent(key)}`), jsonInit("PUT", { value })), "ok");
}

/** One job for the learner's agent; its answer matches `schema`. */
export function askAgent(id: string, prompt: string, schema: unknown): Promise<HostAnswer> {
	return answer(send(pluginUrl(id, "ask"), jsonInit("POST", { prompt, schema })), "answer");
}

/** The space's facts and lessons, read-only: `{ facts: [{ name, statement }], lessons: [{ id, title, kind, updatedAt }] }`. */
export async function readSpace(spaceId: string): Promise<HostAnswer> {
	const space = `space=${encodeURIComponent(spaceId)}`;
	const [graph, chats] = await Promise.all([send(`/api/graph?${space}`, { method: "GET" }), send(`/api/chats?${space}`, { method: "GET" })]);
	const error = graph.error ?? chats.error;
	if (error) return { error };
	const facts = (graph.body as GraphSnapshot).propositions.map(({ name, statement }) => ({ name, statement }));
	const lessons = (chats.body as { chats: ChatListItem[] }).chats.map(({ id, title, kind, updatedAt }) => ({ id, title, kind, updatedAt }));
	return { error: null, value: { facts, lessons } };
}
