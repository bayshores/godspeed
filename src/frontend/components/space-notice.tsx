/**
 * The two corner cards from godspeed's own upkeep of a space. A change
 * card says what a background check changed ("Claude Code updated CSE 21"),
 * with Undo. An overdue card asks "Done?" about the oldest deadline that
 * just went by, with Done and Not yet. Both are the "quiet" kind: one at a
 * time, folded into the pill, never timed, so they wait for the learner.
 * Both wait while a lesson or mock is open.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { useMinute } from "@/frontend/components/countdown";
import { dueWords, overdueToAsk } from "@/frontend/components/home-page/home-page-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { useServerEvent } from "@/frontend/components/server-events";
import { useSpaces } from "@/frontend/components/space-context";
import { followHeld } from "@/frontend/components/teacher/follow";
import { NOTICE_STACK_ID } from "@/frontend/components/top-bar/pill-panel";
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
	const overdue = deadlines && now !== null ? overdueToAsk(deadlines, overdueAsked, now) : null;
	return createPortal(
		<>
			{checks.map((check) => (
				<ChangeCard key={check.spaceId} check={check} onDone={() => setChecks((prev) => prev.filter((c) => c !== check))} />
			))}
			{overdue && now !== null && <OverdueCard key={overdue.id} deadline={overdue} now={now} />}
		</>,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}

type Mode = { kind: "ready" } | { kind: "busy" } | { kind: "undone"; title: string; left: string | null } | { kind: "error"; message: string };

function ChangeCard({ check, onDone }: { check: SpaceCheck; onDone: () => void }) {
	const { spaces, setActive } = useSpaces();
	const navigate = useNavigate();
	const { held, handlers } = useHeld();
	const [mode, setMode] = useState<Mode>({ kind: "ready" });
	useEffect(() => {
		if (held || mode.kind !== "undone") return;
		const id = window.setTimeout(onDone, AFTER_UNDO_MS);
		return () => window.clearTimeout(id);
	}, [held, mode.kind, onDone]);

	const name = spaces.find((s) => s.id === check.spaceId)?.name ?? "a space";
	const { shown, more } = cardLines(check.lines);
	const undo = async () => {
		setMode({ kind: "busy" });
		const { error, body } = await send(`/api/spaces/${encodeURIComponent(check.spaceId)}/checks/${encodeURIComponent(check.run)}/undo`, { method: "POST" });
		setMode(error ? { kind: "error", message: error } : { kind: "undone", ...undoneWords(body) });
	};
	const open = () => {
		if (mode.kind === "undone") return;
		setActive(check.spaceId);
		navigate(changeHref(check.lines));
	};

	if (mode.kind === "undone") {
		return (
			<NoticeCard data-testid="space-notice" role="status" kind="quiet" {...handlers} title={mode.title}>
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
			title={`${check.agent} updated ${name}`}
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
				{check.said && <NoticeText>{check.said}</NoticeText>}
			</button>
			{mode.kind === "error" && (
				<p role="alert" className="text-[13px] text-ans-wrong">
					{mode.message}
				</p>
			)}
		</NoticeCard>
	);
}

function OverdueCard({ deadline: d, now }: { deadline: OpenDeadline; now: number }) {
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
			title={`${d.name} ${dueWords(d, now)}. Done?`}
			actions={
				<>
					<button type="button" data-testid="overdue-notice-done" disabled={busy} onClick={() => markDone(d)} className="lh-btn text-[15px]">
						Done
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
