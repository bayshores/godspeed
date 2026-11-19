/**
 * The two corner cards from godspeed's own upkeep of a space. A change
 * card says what a background check changed ("Claude Code updated CSE 21"),
 * with Undo and a close key that removes it for good. An overdue card asks
 * "Done?" about the oldest deadline that just went by, with Done and Not yet,
 * on every page but Today, whose card asks. Both are the "quiet" kind: one at a
 * time, folded into the pill, never timed, so they wait for the learner.
 * Both wait while a lesson or mock is open.
 */

import { useState } from "react";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useLocation } from "react-router";
import { useMinute } from "@/frontend/components/countdown";
import { overdueToAsk } from "@/frontend/components/home-page/home-page-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { useServerEvent } from "@/frontend/components/server-events";
import { useSpaces } from "@/frontend/components/space-context";
import { useOpenInSpace } from "@/frontend/components/use-join-space";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { followHeld } from "@/frontend/components/teacher/follow";
import { InNoticeStack } from "@/frontend/components/top-bar/pill-panel";
import { useHeld } from "@/frontend/components/use-held";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { send } from "@/frontend/lib/api";
import { addCheck, cardLines, changeHref, undoneWords, type SpaceCheck } from "./space-notice-model";

const AFTER_UNDO_MS = 3_000;

export function SpaceNotice() {
	const { pathname } = useLocation();
	const now = useMinute();
	const { deadlines, overdueAsked } = useOpenDeadlines();
	const [checks, setChecks] = useState<SpaceCheck[]>([]);
	useServerEvent("space-checked", (check) => setChecks((prev) => addCheck(prev, check)));
	if (typeof document === "undefined" || followHeld(pathname, true)) return null;
	// On Today the late card is the one place that asks.
	const overdue = pathname !== "/" && deadlines && now !== null ? overdueToAsk(deadlines, overdueAsked, now) : null;
	return (
		<InNoticeStack>
			{checks.map((check) => (
				<ChangeCard key={check.spaceId} check={check} onDone={() => setChecks((prev) => prev.filter((c) => c !== check))} />
			))}
			{overdue && now !== null && <OverdueCard key={overdue.id} deadline={overdue} />}
		</InNoticeStack>
	);
}

type Mode = { kind: "ready" } | { kind: "busy" } | { kind: "undone"; title: string; left: string | null } | { kind: "error"; message: string };

function ChangeCard({ check, onDone }: { check: SpaceCheck; onDone: () => void }) {
	const { spaces } = useSpaces();
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const openInSpace = useOpenInSpace();
	const [mode, setMode] = useState<Mode>({ kind: "ready" });
	// It waits for the learner until undone, then goes.
	const handlers = useHeld(mode.kind === "undone" ? AFTER_UNDO_MS : null, onDone);

	const closeKey = { onClick: onDone, testId: "space-notice-close" };
	const name = spaces.find((s) => s.id === check.spaceId)?.name ?? "a space";
	const { shown, more } = cardLines(check.lines);
	const undo = async () => {
		setMode({ kind: "busy" });
		const { error, body } = await send(`/api/spaces/${encodeURIComponent(check.spaceId)}/checks/${encodeURIComponent(check.run)}/undo`, { method: "POST" });
		setMode(error ? { kind: "error", message: error } : { kind: "undone", ...undoneWords(body) });
	};
	const open = () => {
		if (mode.kind === "undone") return;
		openInSpace(check.spaceId, changeHref(check.lines));
	};

	if (mode.kind === "undone") {
		return (
			<NoticeCard data-testid="space-notice" role="status" kind="quiet" {...handlers} title={mode.title} close={closeKey}>
				{mode.left && <NoticeText>{mode.left}</NoticeText>}
			</NoticeCard>
		);
	}
	return (
		<NoticeCard
			data-testid="space-notice"
			role="status"
			kind="quiet"
			{...handlers}
			title={`${teacher} updated ${name}`}
			close={closeKey}
			onClick={open}
			actions={
				<button
					type="button"
					data-testid="space-notice-undo"
					disabled={mode.kind === "busy"}
					onClick={(e) => {
						e.stopPropagation();
						void undo();
					}}
					className="lh-btn text-[15px]"
				>
					Undo
				</button>
			}
		>
			<button type="button" data-testid="space-notice-open" className="flex cursor-pointer flex-col gap-1 text-left">
				{shown.map((line) => (
					<NoticeText key={line}>{line}</NoticeText>
				))}
				{more > 0 && <NoticeText>{`and ${more} more`}</NoticeText>}
				{/* The agent's own line mostly retells the change lines: two lines at most. */}
				{check.said && (
					<NoticeText title={check.said}>
						<span className="line-clamp-2">{check.said}</span>
					</NoticeText>
				)}
			</button>
			{mode.kind === "error" && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{mode.message}
				</p>
			)}
		</NoticeCard>
	);
}

function OverdueCard({ deadline: d }: { deadline: OpenDeadline }) {
	const { markDone, reload } = useOpenDeadlines();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const notYet = async () => {
		setBusy(true);
		const result = await send(`/api/deadlines/${encodeURIComponent(d.spaceId)}/${encodeURIComponent(d.id)}/not-yet`, { method: "POST" });
		setBusy(false);
		if (result.error) setError(result.error);
		else await reload();
	};
	return (
		<NoticeCard
			data-testid="overdue-notice"
			role="status"
			kind="quiet"
			title={`Is ${d.name} done?`}
			actions={
				<>
					<button type="button" data-testid="overdue-notice-done" disabled={busy} onClick={() => markDone(d)} className="lh-btn text-[15px]">
						Mark done
					</button>
					<button type="button" data-testid="overdue-notice-not-yet" disabled={busy} onClick={() => void notYet()} className="lh-btn text-[15px]">
						Not yet
					</button>
				</>
			}
		>
			{error && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{error}
				</p>
			)}
		</NoticeCard>
	);
}
