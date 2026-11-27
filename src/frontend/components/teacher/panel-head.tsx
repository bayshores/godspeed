import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePresence } from "@/frontend/components/presence";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { cn } from "@/frontend/lib/utils";
import { PanelChats } from "./panel-chats";
import { TeacherActivity } from "./teacher-activity";
import { useTeacher } from "./teacher-context";


/**
 * The panel's one head row, dark like the top bar: the teacher's name with a
 * square that breathes while the teacher works anywhere (the name gives way
 * to "Working" while the work is outside the panel's chat, which shows its
 * own in its thread), then Chats, Follow (held down while the window goes
 * where the teacher works), Activity and Pop out. Chats and Activity each
 * drop their list over the top of the chat, one at a time. While the chat is
 * in a window of its own, Activity is the panel's body and its key gives way
 * to Put back, which is also the only key in that window's head. On a page
 * with its own box for the teacher the head is the name alone. While the
 * agent can't run (`blocked`) only Activity stays: Chats, Follow and Pop out
 * fade back once it can. The strip beside it names the panel, and the strip
 * that opened it closes it.
 */
export function PanelHead({
	name,
	working,
	elsewhere,
	list,
	popOut,
	putBack,
	blocked,
}: {
	name: string;
	/** The teacher works, here or anywhere. */
	working: boolean;
	/** It works outside the panel's chat. */
	elsewhere: boolean;
	/** The Activity list its key drops; null where there is none. */
	list: { open: boolean; onOpen: (open: boolean) => void } | null;
	/** Moves the chat to a window of its own; null where there is none. */
	popOut: (() => void) | null;
	/** The chat is in its own window: the key that brings it back. */
	putBack: (() => void) | null;
	blocked: boolean;
}) {
	const teacher = useTeacher();
	const listKey = useRef<HTMLButtonElement>(null);
	const chatsKey = useRef<HTMLButtonElement>(null);
	const card = useRef<HTMLDivElement>(null);
	const listId = useId();
	const listOpen = !!list?.open;
	// The panel's own head has Chats and Follow; the popped window's has no teacher.
	const own = !!(list || putBack) && !!teacher && !blocked;
	const chatsThere = own && !!list;
	// The keys that went while the agent couldn't run fade back; at the panel's opening they are at rest.
	const [cameBack, setCameBack] = useState(false);
	if (blocked && !cameBack) setCameBack(true);
	const back = cameBack && "lh-fade";
	const [chatsWanted, setChatsWanted] = useState(false);
	const chatsOpen = chatsWanted && chatsThere && !listOpen;
	const open = listOpen ? "activity" : chatsOpen ? "chats" : null;
	const hang = usePresence(open !== null);
	// What hangs stays drawn while it goes back up.
	const [hung, setHung] = useState<"activity" | "chats">("activity");
	if (open && open !== hung) setHung(open);
	// The list hangs into the panel, which clips it: it may reach the panel's
	// bottom and no further, whatever the chat's height.
	const head = useRef<HTMLDivElement>(null);
	const [room, setRoom] = useState<number | null>(null);
	useLayoutEffect(() => {
		const el = head.current;
		const panel = el?.parentElement;
		if (!hang.mounted || !el || !panel) return;
		const read = () => setRoom(panel.clientHeight - el.offsetTop - el.offsetHeight);
		read();
		const observer = new ResizeObserver(read);
		observer.observe(panel);
		observer.observe(el);
		return () => observer.disconnect();
	}, [hang.mounted]);
	// Opened, the keyboard goes into it, as into a menu.
	useEffect(() => {
		if (open) card.current?.focus({ preventScroll: true });
	}, [open]);
	// It closes on a click outside it, or on Esc, which goes no further and
	// gives the keyboard back to its key.
	const onOpen = list?.onOpen;
	useEffect(() => {
		if (!open) return;
		const close = () => {
			onOpen?.(false);
			setChatsWanted(false);
		};
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node | null;
			if (!card.current?.contains(t) && !listKey.current?.contains(t) && !chatsKey.current?.contains(t)) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			close();
			(open === "chats" ? chatsKey : listKey).current?.focus();
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [open, onOpen]);

	const words = elsewhere ? "Working" : name;
	const statusChip = (
		<span data-testid="teacher-panel-agent" title={words} className="flex min-w-0 items-center gap-2.5 text-left text-[15px] leading-5 text-bar-ink">
			<span aria-hidden className={cn("size-2 shrink-0 bg-current", working && "ob-pulse")} />
			<span key={words} data-state="open" className="lh-fade min-w-0 truncate">
				{words}
			</span>
		</span>
	);

	return (
		// Over the panel's resize edges while its list is open, so they never cover the list.
		<div ref={head} data-hang={open ? "" : undefined} className={cn("peer relative flex shrink-0 flex-col bg-bar pr-1 pl-[18px]", hang.mounted ? "z-40" : "z-10")}>
			<div className="flex h-12 items-center">
				<div className="flex min-w-0 flex-1 items-center pr-2">{statusChip}</div>
				{chatsThere && (
					<button
						ref={chatsKey}
						type="button"
						data-testid="teacher-panel-chats"
						aria-expanded={chatsOpen}
						aria-controls={chatsOpen ? listId : undefined}
						onClick={() => {
							list?.onOpen(false);
							setChatsWanted(!chatsOpen);
						}}
						className={cn(barWord(chatsOpen), back)}
					>
						Chats
					</button>
				)}
				{own && (
					<button
						type="button"
						data-testid={teacher.follow ? "follow-stop" : "follow-start"}
						aria-pressed={teacher.follow}
						onClick={() => teacher.setFollow(!teacher.follow)}
						className={cn(barWord(teacher.follow), back)}
					>
						{teacher.follow ? "Following" : "Follow"}
					</button>
				)}
				{list && (
					<button
						ref={listKey}
						type="button"
						data-testid="teacher-panel-activity"
						aria-expanded={listOpen}
						aria-controls={listOpen ? listId : undefined}
						onClick={() => {
							setChatsWanted(false);
							list.onOpen(!listOpen);
						}}
						className={barWord(listOpen)}
					>
						Activity
					</button>
				)}
				{popOut && !blocked && (
					<button type="button" data-testid="teacher-panel-pop-out" onClick={popOut} className={cn(barWord(false), back)}>
						Pop out
					</button>
				)}
				{putBack && (
					<button type="button" data-testid="teacher-panel-put-back" onClick={putBack} className={barWord(false)}>
						Put back
					</button>
				)}
			</div>
			{hang.mounted && (
				<div data-state={hang.state} className="lh-hang absolute inset-x-0 top-full">
					<div ref={card} id={listId} role="dialog" aria-label={hung === "chats" ? "Chats" : "Activity"} tabIndex={-1} data-state={hang.state} data-testid="teacher-panel-list" style={room === null ? undefined : { maxHeight: `min(${room}px, (100dvh - var(--lh-bar-h)) * 0.6)` }} className="lh-hang-body flex outline-none max-h-[calc((100dvh-var(--lh-bar-h))*0.6)] flex-col overflow-y-auto bg-bar px-[18px] pt-1 pb-5">
						{hung === "chats" ? <PanelChats onDone={() => setChatsWanted(false)} /> : <TeacherActivity />}
					</div>
				</div>
			)}
		</div>
	);
}
