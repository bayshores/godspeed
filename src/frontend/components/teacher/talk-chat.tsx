import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentModels, ChatInput, LhMessage, TalkChat } from "@/shared/core";
import { useAgentFolderView } from "@/frontend/components/agent-folder/agent-folder-context";
import { useAgentModels } from "@/frontend/components/agent-folder/use-agent-models";
import { LoadFailed } from "@/frontend/components/load-failed";
import { AgentAtWork } from "@/frontend/components/lesson/agent-at-work";
import { AskShownContext } from "@/frontend/components/lesson/approval-card";
import { useArrivals } from "@/frontend/components/lesson/arrivals";
import type { AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { restoreUnsent } from "@/frontend/components/lesson/chat-helpers";
import { MessageAttachments } from "@/frontend/components/lesson/message-attachments";
import { useDesk } from "@/frontend/components/lesson/use-desk";
import { useLessonServer, type ChatRead } from "@/frontend/components/lesson/use-lesson-server";
import { useLessonWork } from "@/frontend/components/lesson/use-lesson-work";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { QueuedSteersBody } from "@/frontend/components/queued-steers";
import { useChatSession } from "@/frontend/components/session";
import { visibleQueuedSteers } from "@/frontend/components/session-core";
import { getJson, jsonInit, send } from "@/frontend/lib/api";
import { cn } from "@/frontend/lib/utils";
import { ModelKey } from "./model-key";
import { SetupFoot, useAskable } from "./setup-foot";
import { everything, startersFor, type BoxPage, type IdeaGroup } from "./starter-model";
import { readEarlier, talkError, talkLines } from "./talk-model";
import { TeacherThread, type ThreadLine } from "./teacher-thread";
import { TryAsking } from "./try-asking";
import { useIdeaFacts } from "./use-idea-facts";
import { useBox, type Box } from "./use-talk-box";
import { AFTER_GLIDE_MS, useCardAway, useThreadScroll } from "./use-thread-scroll";
import { WritingRow } from "./writing-row";

type TextInput = Extract<ChatInput, { type: "text" }>;

/** A line a page key handed the teacher; `clear` once it is sent. */
type Asking = { line: string; clear: () => void } | null;

/**
 * THE TEACHER PANEL'S CHAT: godspeed's own chat with the teacher, in the panel and in the window
 * it pops out to. A new chat (`chatId` null) offers "Try asking" and its lines for the page on
 * screen; the chat record is made on the first send, which names it. A chat shows its thread
 * (TeacherThread), the desk while a reply is written, and the writing row pinned at the foot: the
 * box, then Ideas, the chat's model, Stop and Send on their own line. On a page with its own box
 * (`page`) the writing row gives way to one quiet line, with Stop beside it while a reply runs; the
 * box's words and files are kept. While the agent can't run, the setup line stands in the writing
 * row's place (SetupFoot) and "Try asking" waits, dim.
 */
export function TalkChatView({ chatId, chat, onChat, name, page, ask, focus }: {
	chatId: string | null;
	/** The shown chat's row in the list, for its model; null for a new chat or one not listed yet. */
	chat: TalkChat | null;
	/** A new chat was made: it is the one shown now. */
	onChat: (id: string) => void;
	name: string;
	page: BoxPage | null;
	ask: Asking;
	/** The learner opened it: the box takes the keyboard. */
	focus: boolean;
}) {
	const box = useBox();
	// The first message of a chat made here, which the chat sends once it is shown.
	const [first, setFirst] = useState<{ chatId: string; input: TextInput } | null>(null);
	// A model picked for a chat before the list says so.
	const [picked, setPicked] = useState<{ chatId: string; model: string } | null>(null);
	const room = { name, page, box, ask, focus };
	if (chatId === null)
		return (
			<NewChat
				{...room}
				onMade={(id, input, model) => {
					if (model) setPicked({ chatId: id, model });
					setFirst({ chatId: id, input });
					onChat(id);
				}}
			/>
		);
	const pick = (id: string) => {
		setPicked({ chatId, model: id });
		void setModel(chatId, id);
	};
	const model = picked?.chatId === chatId ? picked.model : (chat?.model ?? null);
	return <ChatRoom key={chatId} chatId={chatId} first={first?.chatId === chatId ? first.input : null} model={model} onModel={pick} {...room} />;
}

/** A failed pick only means the chat goes on with its model; the next pick tries again. */
async function setModel(chatId: string, model: string): Promise<void> {
	const { error } = await send(`/api/chats/${encodeURIComponent(chatId)}`, jsonInit("PATCH", { model }));
	if (error) console.error(`[teacher panel] setting the chat's model failed: ${error}`);
}

interface RoomProps {
	name: string;
	page: BoxPage | null;
	box: Box;
	ask: Asking;
	focus: boolean;
}

/** A chat's model, and the pick that changes it. */
interface ModelProps {
	model: string | null;
	onModel: (id: string) => void;
}

const sendInput = (text: string, files: AttachmentDraft["files"]): TextInput => ({ type: "text", text, ...(files.length > 0 ? { attachments: files.map((f) => f.attachment) } : {}) });

function NewChat({ name, page, box, ask, focus, onMade }: RoomProps & { onMade: (id: string, input: TextInput, model: string | null) => void }) {
	// A pick for the chat this box makes is kept with the box, across a reload, and goes with its first message.
	const models = useAgentModels();
	const model = box.nextModel(models.agent);
	const pick = (id: string) => {
		if (models.agent) box.pickNext({ agent: models.agent, model: id });
	};
	const facts = useIdeaFacts();
	const starters = startersFor(facts);
	const groups = useMemo(() => everything(facts), [facts]);
	const off = useAskable() !== true;
	const [failed, setFailed] = useState<string | null>(null);
	const sending = useRef(false);
	const make = async (input: TextInput, restore: () => void) => {
		if (sending.current) return;
		sending.current = true;
		setFailed(null);
		const made = await send("/api/chats", jsonInit("POST", { kind: "talk", text: input.text, ...(model ? { model } : {}) }));
		sending.current = false;
		const id = (made.body as { id?: unknown } | null)?.id;
		if (made.error || typeof id !== "string") {
			setFailed("Your message didn't go through.");
			restore();
			return;
		}
		box.pickNext(null);
		onMade(id, input, model);
	};
	const sendBox = () => {
		const typed = box.text.trim();
		const files = box.files.files;
		if (!typed && files.length === 0) return;
		box.setText("");
		box.files.clear();
		void make(sendInput(typed, files), () => {
			box.setText((now) => restoreUnsent(typed, now));
			box.files.restore(files);
		});
	};
	const sendLine = (line: string) => void make({ type: "text", text: line }, () => {});
	useEffect(() => {
		if (!ask) return;
		ask.clear();
		sendLine(ask.line);
	});
	return (
		<Room
			body={<TryAsking starters={starters} groups={groups} off={off} onSend={sendLine} />}
			foot={
				<WritingRow name={name} page={page} box={box} focus={focus} busy={false} error={failed ? { text: failed, onRetry: null } : null} ideas={null} made={false} model={<ModelKeyFor models={models} model={model} onModel={pick} />} onSend={sendBox} onLine={sendLine} onStop={null} />
			}
		/>
	);
}

/** The model key with the agent's list. A chat with no model of its own starts on the one the
 *  learner picked for the agent in Settings, else the agent's own default. */
function ModelKeyFor({ models: { agent, models }, model, onModel }: ModelProps & { models: AgentModels }) {
	const view = useAgentFolderView().view;
	const start = agent && view ? view.model[agent] : undefined;
	return <ModelKey models={models} current={model ?? start ?? null} onPick={onModel} />;
}

/** What a chat's read holds that the panel draws from. */
type Read = Pick<ChatRead, "messages" | "turnInFlight"> & Partial<Pick<ChatRead, "turnError" | "turns" | "pricing" | "summarizeAt">> & { earlier?: unknown };

/** A chat just made here has nothing to read yet. */
const MADE: Read = { messages: [], turnInFlight: false };

function ChatRoom({ chatId, first, ...room }: RoomProps & ModelProps & { chatId: string; first: TextInput | null }) {
	const [read, setRead] = useState<Read | null>(first ? MADE : null);
	const [failed, setFailed] = useState(false);
	const load = useCallback(() => {
		setFailed(false);
		void getJson<Read & { messages?: LhMessage[] }>(`/api/chats/${encodeURIComponent(chatId)}`).then(({ body }) => {
			if (body && Array.isArray(body.messages)) setRead(body);
			else setFailed(true);
		});
	}, [chatId]);
	const wanted = useRef(read === null);
	useEffect(() => {
		if (wanted.current) load();
	}, [load]);
	if (failed) return <Room body={<LoadFailed message="This chat couldn't be opened." onRetry={load} className="py-10" />} foot={null} />;
	if (!read) return <Room body={null} foot={null} />;
	return <Live chatId={chatId} read={read} first={first} {...room} />;
}

function Live({ chatId, read, first, name, page, box, ask, model, onModel, focus }: RoomProps & ModelProps & { chatId: string; read: Read; first: TextInput | null }) {
	const models = useAgentModels();
	const session = useChatSession({ chatId, initialMessages: read.messages, initialError: read.turnError, initiallyInFlight: read.turnInFlight });
	const { turnInFlight, localStreamRef } = useLessonServer({ chatId, session, initiallyInFlight: read.turnInFlight, initialStats: read, initialJobs: [] });
	const work = useLessonWork(chatId, undefined);
	const busy = session.status === "submitted" || session.status === "streaming" || turnInFlight;
	const { desk, closing } = useDesk(session.messages, busy, work, name);
	const earlier = useMemo(() => readEarlier(read.earlier), [read.earlier]);
	const talk = talkLines(session.messages, earlier, session.status === "streaming");
	const arrive = useArrivals();
	// What the chat's first drawing holds stays at rest; a desk that opens later rises in.
	const [drawn, setDrawn] = useState(false);
	useEffect(() => setDrawn(true), []);
	const lines = talk.map((line): ThreadLine => ({ key: line.key, who: line.who, text: line.text, writing: line.writing, under: line.files.length > 0 ? <MessageAttachments parts={line.files} /> : undefined }));
	const steers = visibleQueuedSteers(session.steerQueue, session.nativeMessages);
	const waiting = (busy || closing) && steers.length > 0 ? <QueuedSteersBody steers={steers} /> : null;

	const { send: sendInputNow, steer, stop, clearError, resumeStream } = session;
	const go = useCallback((input: TextInput): Promise<boolean> => (busy ? steer(input.text) : sendInputNow(input)), [busy, steer, sendInputNow]);
	// The first message of a chat made here goes before the chat is first painted, so its plate
	// takes the room "Try asking" held with no blank frame between.
	const sentFirst = useRef(false);
	useLayoutEffect(() => {
		if (!first || sentFirst.current) return;
		sentFirst.current = true;
		void sendInputNow(first);
	}, [first, sendInputNow]);
	useEffect(() => {
		if (!ask) return;
		ask.clear();
		void go({ type: "text", text: ask.line });
	});
	const sendBox = () => {
		const typed = box.text.trim();
		const files = box.files.files;
		if (!typed && files.length === 0) return;
		box.setText("");
		box.files.clear();
		void go(sendInput(typed, files)).then((taken) => {
			if (taken) return;
			box.setText((now) => restoreUnsent(typed, now));
			box.files.restore(files);
		});
	};
	const stopTurn = () => {
		if (localStreamRef.current) stop();
		// A failed abort is transient: the turn settles on its own.
		void send("/api/activity/abort", jsonInit("POST", { kind: "turn", id: chatId }));
	};
	const failure = session.error && !busy ? talkError(session.error.message) : null;
	const retry = failure?.retry;
	const error = failure && {
		text: failure.text,
		detail: session.error?.message,
		onRetry: retry === "again" ? () => void sendInputNow({ type: "continue" }) : retry === "read"
					? () => {
							clearError();
							resumeStream();
						}
					: null,
	};

	const scroller = useRef<HTMLDivElement>(null);
	const exchange = useRef<HTMLElement>(null);
	useThreadScroll(scroller, exchange, talk.filter((line) => line.who === "you").length);
	const cardAway = useCardAway(scroller, work.approvals);
	const glide = useCallback((card: HTMLElement) => card.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "instant" : "smooth" }), []);

	const deskBlock = desk && (
		<DeskIn live={drawn} afterSend={talk.at(-1)?.who === "you"}>
			<div data-state={closing ? "closed" : "open"} inert={closing} className={cn("flex flex-col", closing && "lh-fade")}>
				<AgentAtWork chatId={chatId} head={desk.head} writing={desk.writing} work={desk.work} arrive={arrive} foot={waiting} paper={false} room={null} closing={closing} />
			</div>
		</DeskIn>
	);
	const used = talk.length > 0;
	const groups = useIdeaGroups();
	return (
		<AskShownContext.Provider value={glide}>
			<Room
				scroller={scroller}
				body={<TeacherThread lines={lines} arrive={arrive} exchange={exchange} live={<>{deskBlock}{!desk && waiting}</>} />}
				over={cardAway && <CardAway text={cardAway.text} onClick={() => glide(cardAway.card)} />}
				foot={<WritingRow name={name} page={page} box={box} focus={focus} busy={busy} error={error} ideas={used ? groups : null} made={first !== null} model={<ModelKeyFor models={models} model={model} onModel={onModel} />} onSend={sendBox} onLine={(line) => void go({ type: "text", text: line })} onStop={stopTurn} />}
			/>
		</AskShownContext.Provider>
	);
}

function useIdeaGroups(): IdeaGroup[] {
	const facts = useIdeaFacts();
	return useMemo(() => everything(facts), [facts]);
}

/** The desk rises in when it opens while the chat is shown; under a line just sent, once the view
 *  has glided there. */
function DeskIn({ live, afterSend, children }: { live: boolean; afterSend: boolean; children: ReactNode }) {
	const [delay] = useState(live ? `${afterSend ? AFTER_GLIDE_MS : 0}ms` : null);
	return (
		<div className={cn("flex flex-col", delay && "lh-rise")} style={delay ? { animationDelay: delay } : undefined}>
			{children}
		</div>
	);
}

/** One row pinned over the writing row while a card waits out of view: the card's own sentence; a
 *  click glides back to the card. */
function CardAway({ text, onClick }: { text: string; onClick: () => void }) {
	return (
		<button type="button" data-testid="talk-card-away" onClick={onClick} className="lh-block-in lh-sheet lh-press mx-[18px] mb-2 truncate px-3 py-2 text-left text-[15px] text-ink hover:bg-(--lh-key-hover)">
			{text}
		</button>
	);
}

/** The panel's body: the scrolling room, anything pinned over the foot, and the foot. */
function Room({ body, over, foot, scroller }: { body: ReactNode; over?: ReactNode; foot: ReactNode; scroller?: React.Ref<HTMLDivElement> }) {
	return (
		<div data-testid="talk-chat" className="relative flex min-h-0 flex-1 flex-col">
			<div ref={scroller} data-testid="talk-thread" className="relative min-h-0 flex-1 overflow-y-auto px-[18px] pt-4 pb-4">
				{body}
			</div>
			{over}
			<SetupFoot>{foot}</SetupFoot>
		</div>
	);
}

