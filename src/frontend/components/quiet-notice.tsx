/**
 * The corner notice when a class's linked folder has brought no new file
 * for a few days (say, whatever fills a Google Drive folder stopped): "No
 * new files in CSE 29 for 4 days", with Show folder, See files and a close
 * button. Closing it snoozes it, remembered in this browser only.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { CalendarClockIcon, XIcon } from "lucide-react";
import { useClasses } from "@/frontend/components/class-context";
import { useMinute } from "@/frontend/components/countdown";
import { NOTICE_STACK_ID } from "@/frontend/components/notice-stack";
import { quietClasses, quietLine, quietTitle, snoozeEnd, type QuietClass } from "./quiet-notice-model";

const SNOOZED_KEY = "lh:quiet-snoozed";

function readSnoozed(): Record<string, number> {
	try {
		const saved: unknown = JSON.parse(window.localStorage.getItem(SNOOZED_KEY) ?? "{}");
		if (!saved || typeof saved !== "object") return {};
		return Object.fromEntries(Object.entries(saved).filter((e): e is [string, number] => typeof e[1] === "number"));
	} catch {
		return {};
	}
}

export function QuietNotice() {
	const { classes, setActive } = useClasses();
	const now = useMinute();
	const navigate = useNavigate();
	const [snoozed, setSnoozed] = useState(() => (typeof window === "undefined" ? {} : readSnoozed()));
	if (typeof document === "undefined" || now === null) return null;
	const snooze = (classId: string) => {
		// Expired snoozes are dropped so the saved list stays small.
		const next = Object.fromEntries(Object.entries(snoozed).filter(([, until]) => until > now));
		next[classId] = snoozeEnd(now);
		setSnoozed(next);
		try {
			window.localStorage.setItem(SNOOZED_KEY, JSON.stringify(next));
		} catch {
			// Only a convenience: it shows again next launch.
		}
	};
	const openPath = window.lh?.openPath;
	return createPortal(
		<QuietNoticeView
			quiet={quietClasses(classes, snoozed, now)}
			now={now}
			onShowFolder={openPath && ((entry) => void openPath(entry.folder))}
			onSee={(entry) => {
				setActive(entry.classId);
				navigate("/class/files");
			}}
			onDismiss={(entry) => snooze(entry.classId)}
		/>,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}

export function QuietNoticeView({
	quiet,
	now,
	onShowFolder,
	onSee,
	onDismiss,
}: {
	quiet: readonly QuietClass[];
	now: number;
	/** Absent outside the desktop app (nothing can open the folder). */
	onShowFolder?: (entry: QuietClass) => void;
	onSee: (entry: QuietClass) => void;
	onDismiss: (entry: QuietClass) => void;
}) {
	const button = "lh-press border border-tone-2 px-3 py-1 text-[13px] font-bold hover:bg-tone";
	return (
		<>
			{quiet.map((entry) => (
				<div key={entry.classId} data-testid="quiet-notice" role="status" className="lh-rise lh-popup flex w-[340px] max-w-full items-start gap-3 px-4 py-3 font-ui text-[13.5px] text-ink">
					<CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<p className="font-bold">{quietTitle(entry, now)}</p>
						<p className="text-xs text-ink-3">{quietLine(entry)}</p>
						<div className="flex gap-2 pt-1.5">
							{onShowFolder && (
								<button type="button" data-testid="quiet-notice-folder" onClick={() => onShowFolder(entry)} className={button}>
									Show folder
								</button>
							)}
							<button type="button" data-testid="quiet-notice-see" onClick={() => onSee(entry)} className={button}>
								See files
							</button>
						</div>
					</div>
					<button type="button" data-testid="quiet-notice-close" aria-label="Close" onClick={() => onDismiss(entry)} className="lh-press text-ink-3 hover:text-ink">
						<XIcon className="size-3.5" aria-hidden />
					</button>
				</div>
			))}
		</>
	);
}
