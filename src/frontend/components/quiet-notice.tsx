/**
 * The corner notice when a space's linked folder has brought no new file
 * for a few days (say, whatever fills a Google Drive folder stopped): "No
 * new files in CSE 29 for 4 days", with Show folder, See files and a close
 * button. Closing it snoozes it, remembered in this browser only.
 */

import { useState } from "react";
import { useSpaces } from "@/frontend/components/space-context";
import { useOpenInSpace } from "@/frontend/components/use-join-space";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { useMinute } from "@/frontend/components/countdown";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { InNoticeStack } from "@/frontend/components/strip/peek-sheet";
import { quietSpaces, quietLine, quietTitle, snoozeEnd, type QuietSpace } from "./quiet-notice-model";

const SNOOZED_KEY = "lh:quiet-snoozed";

function readSnoozed(): Record<string, number> {
	try {
		const saved: unknown = JSON.parse(readStorage(SNOOZED_KEY) ?? "{}");
		if (!saved || typeof saved !== "object") return {};
		return Object.fromEntries(Object.entries(saved).filter((e): e is [string, number] => typeof e[1] === "number"));
	} catch {
		return {};
	}
}

export function QuietNotice() {
	const { spaces } = useSpaces();
	const now = useMinute();
	const openInSpace = useOpenInSpace();
	const [snoozed, setSnoozed] = useState(() => (typeof window === "undefined" ? {} : readSnoozed()));
	if (typeof document === "undefined" || now === null) return null;
	const snooze = (spaceId: string) => {
		// Expired snoozes are dropped so the saved list stays small.
		const next = Object.fromEntries(Object.entries(snoozed).filter(([, until]) => until > now));
		next[spaceId] = snoozeEnd(now);
		setSnoozed(next);
		// Only a convenience: it shows again next launch.
		writeStorage(SNOOZED_KEY, JSON.stringify(next));
	};
	const openPath = window.lh?.openPath;
	return (
		<InNoticeStack>
			<QuietNoticeView
				quiet={quietSpaces(spaces, snoozed, now)}
				now={now}
				onShowFolder={openPath && ((entry) => void openPath(entry.folder))}
				onSee={(entry) => {
					openInSpace(entry.spaceId, "/space/files");
				}}
				onDismiss={(entry) => snooze(entry.spaceId)}
			/>
		</InNoticeStack>
	);
}

export function QuietNoticeView({
	quiet,
	now,
	onShowFolder,
	onSee,
	onDismiss,
}: {
	quiet: readonly QuietSpace[];
	now: number;
	/** Absent outside the desktop app (nothing can open the folder). */
	onShowFolder?: (entry: QuietSpace) => void;
	onSee: (entry: QuietSpace) => void;
	onDismiss: (entry: QuietSpace) => void;
}) {
	const button = "lh-btn text-[15px]";
	return (
		<>
			{quiet.map((entry) => (
				<NoticeCard
					key={entry.spaceId}
					data-testid="quiet-notice"
					kind="quiet"
					role="status"
					title={quietTitle(entry, now)}
					close={{ onClick: () => onDismiss(entry), testId: "quiet-notice-close" }}
					actions={
						<>
							{onShowFolder && (
								<button type="button" data-testid="quiet-notice-folder" onClick={() => onShowFolder(entry)} className={button}>
									Show folder
								</button>
							)}
							<button type="button" data-testid="quiet-notice-see" onClick={() => onSee(entry)} className={button}>
								See files
							</button>
						</>
					}
				>
					<NoticeText>{quietLine(entry)}</NoticeText>
				</NoticeCard>
			))}
		</>
	);
}
