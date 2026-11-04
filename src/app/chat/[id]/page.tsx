import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { compactionInFlight, getChat, isTurnRunning, turnFailure } from "@/server";

export const dynamic = "force-dynamic";

/** One read of the record per request: the title and the page share it. */
const chatFor = cache(getChat);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
	const { id } = await params;
	return { title: chatFor(id)?.title || "Lesson" };
}

export default async function ChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ prompt?: string }>;
}) {
	const [{ id }, { prompt }] = await Promise.all([params, searchParams]);
	const chat = chatFor(id);
	// The Talk chat lives in the teacher's panel, never on a lesson page.
	if (!chat || chat.kind === "talk") notFound();
	return (
		<Chat
			key={chat.id}
			chatId={chat.id}
			title={chat.title}
			kind={chat.kind ?? "teach"}
			// A study session's plan is written at birth, not by a plan_init call.
			initialTree={chat.tree}
			classId={chat.classId}
			deadlineId={chat.deadlineId}
			// The record IS native agent history — the client view is
				// derived app-side (core/view.ts projectView; GET serves the same
				// native messages).
				initialMessages={chat.messages}
			initialError={turnFailure(chat.id)}
			initialPrompt={prompt}
			// A teacher turn that outlived its client: the remounted view must
			// attach (busy shimmer + poll), never resurrect the stale record.
			initiallyInFlight={isTurnRunning(chat.id)}
			initiallyCompacting={compactionInFlight(chat.id)}
		/>
	);
}
