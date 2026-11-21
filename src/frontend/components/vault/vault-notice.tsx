/**
 * The corner notice when notes could not be written to the notes folder: "Couldn't save 2 notes
 * to Obsidian." with the reason under it and "Try again" (or "Settings" when the folder is gone).
 * It stays until the notes are saved or it is closed, and comes back when the trouble changes.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { InNoticeStack } from "@/frontend/components/strip/peek-sheet";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { useVault } from "./vault-context";
import { waitingLine } from "./vault-model";

export function VaultNotice() {
	const { status, retry } = useVault();
	const navigate = useNavigate();
	const again = useGuardedAction();
	const [closed, setClosed] = useState<string | null>(null);
	const waiting = status?.waiting ?? null;
	if (!status || !waiting || typeof document === "undefined") return null;
	const title = waitingLine(waiting.count, status.obsidian);
	const key = `${title} ${waiting.why}`;
	if (closed === key) return null;
	const gone = status.state === "missing";
	return (
		<InNoticeStack>
			<NoticeCard
				data-testid="vault-notice"
				role="status"
				title={title}
				close={{ onClick: () => setClosed(key), testId: "vault-notice-close" }}
				actions={
					<button
						type="button"
						data-testid="vault-notice-key"
						disabled={again.busy}
						onClick={() => (gone ? navigate("/settings") : void again.run(retry))}
						className="lh-btn text-[15px]"
					>
						{gone ? "Settings" : "Try again"}
					</button>
				}
			>
				<NoticeText>{again.error ?? waiting.why}</NoticeText>
			</NoticeCard>
		</InNoticeStack>
	);
}
