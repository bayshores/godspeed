"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { spaceColorVar } from "@/frontend/components/space-color";
import { spaceName, useSpaces } from "@/frontend/components/space-context";
import { lessonAge, matchLessons } from "@/frontend/components/lessons/lessons-model";
import { useLessonList } from "@/frontend/components/lessons/use-lesson-list";
import { LoadFailed } from "@/frontend/components/load-failed";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { Popup } from "@/frontend/components/ui/popup";
import { cn } from "@/frontend/lib/utils";
import { kbdEventForAction } from "@/shared/core";

/**
 * SEARCH LESSONS: one popup over the lessons of every space, opened from
 * Menu or the search shortcut. In the field ↑/↓ walk the matches and Enter
 * opens the walked one (or the first).
 */
export function SearchLessons() {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		const name = kbdEventForAction("sessions-search");
		const onOpen = () => setOpen(true);
		window.addEventListener(name, onOpen);
		return () => window.removeEventListener(name, onOpen);
	}, []);
	const close = useCallback(() => setOpen(false), []);
	return (
		<Popup open={open} onClose={close} title="Search lessons" testid="search-lessons" className="max-w-[640px]">
			<Results onClose={close} />
		</Popup>
	);
}

/** The field and its matches; the lessons load when the popup opens. */
function Results({ onClose }: { onClose: () => void }) {
	const router = useRouter();
	const { spaces } = useSpaces();
	const { chats, failed, refresh } = useLessonList();
	const [query, setQuery] = useState("");
	const [walked, setWalked] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const shown = useMemo(() => (chats ? matchLessons(chats, query) : null), [chats, query]);

	// Keep the walked row in view.
	useEffect(() => {
		listRef.current?.children[walked]?.scrollIntoView({ block: "nearest" });
	}, [walked]);

	const openLesson = (id: string) => {
		onClose();
		router.push(`/chat/${id}`);
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const n = shown?.length ?? 0;
		if (n === 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault(); // the rows move, not the caret
			setWalked((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const target = shown?.[Math.min(walked, n - 1)];
			if (target) openLesson(target.id);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<input
				data-autofocus=""
				data-testid="search-lessons-field"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setWalked(0); // the list reorders under the query
				}}
				onKeyDown={onKeyDown}
				placeholder="Search every lesson"
				aria-label="Search every lesson"
				spellCheck={false}
				className="h-11 w-full rounded-[2px] border-2 border-ink bg-tone px-3 text-base text-ink outline-none placeholder:text-ink-3"
			/>
			{shown === null ? (
				failed ? (
					<LoadFailed message="Couldn't load your lessons." onRetry={() => void refresh()} className="py-3" />
				) : (
					<p className="py-3 text-[15px] text-ink-2">Loading…</p>
				)
			) : shown.length === 0 ? (
				<p className="py-3 text-[15px] text-ink-2">{query.trim() ? "No lessons match." : "No lessons yet."}</p>
			) : (
				<div ref={listRef} className="flex flex-col">
					{shown.map((c, i) => {
						const space = spaces.find((k) => k.id === c.spaceId);
						return (
							<button
								key={c.id}
								type="button"
								data-testid="search-lessons-row"
								aria-current={i === walked}
								onClick={() => openLesson(c.id)}
								className={cn("lh-press flex items-center gap-4 border-b border-dotted border-edge px-2 py-3 text-left last:border-b-0 hover:bg-accent", i === walked && "bg-accent")}
							>
								<span aria-hidden className="w-2 shrink-0 self-stretch bg-ink-3" style={space && { background: spaceColorVar(space.color) }} />
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="truncate text-[17px] text-ink">{c.title}</span>
									<span className="truncate text-sm text-ink-2">{spaceName(spaces, c.spaceId)}</span>
								</span>
								<span className="font-count shrink-0 text-sm text-ink-2">{lessonAge(c.updatedAt)}</span>
								<PixelIcon name="chevron" className="text-ink" />
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
