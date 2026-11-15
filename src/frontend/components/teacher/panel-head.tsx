import { cn } from "@/frontend/lib/utils";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import type { TerminalRole } from "@/frontend/components/terminal/terminal-model";
import type { PanelView } from "./dock-model";

/** The swap key names where it goes, the same word the lesson's teacher column uses. */
const VIEW_LABEL: Record<PanelView, string> = {
  activity: "Activity",
  terminal: "Terminal",
};

const KEY = "lh-btn h-8 shrink-0 px-3 text-[14px]";

/**
 * The panel's one head row: the teacher's name (or, while a helper runs,
 * the Teacher and Helper switch, which names the screen shown) with its
 * status as a chip, lit while it needs the learner; then the key that
 * swaps the body and Close.
 */
export function PanelHead({
  name,
  status,
  needsYou,
  screens,
  other,
  bodyId,
  onView,
  onClose,
}: {
  name: string;
  status: string | null;
  needsYou: boolean;
  /** The switch while a helper runs: the screen shown, which screen calls, and the pick. */
  screens: {
    shown: TerminalRole;
    calls: (role: TerminalRole) => boolean;
    onPick: (role: TerminalRole) => void;
  } | null;
  /** Where the swap key goes; null when the body has one view. */
  other: PanelView | null;
  bodyId: string;
  onView: (view: PanelView) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 py-3 pr-3 pl-[15px]">
      {/* In the narrow panel the chip goes under the name. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
        {screens ? (
          <div
            role="group"
            aria-label="Screen"
            className="flex shrink-0 rounded-[12px] bg-tone p-0.5"
          >
            {(["teacher", "helper"] as const).map((role) => (
              <button
                key={role}
                type="button"
                aria-pressed={screens.shown === role}
                data-testid={`terminal-screen-${role}`}
                onClick={() => screens.onPick(role)}
                className={cn(
                  KEY,
                  "gap-1.5",
                  screens.shown !== role && "lh-btn-quiet",
                )}
              >
                <span className="max-w-32 truncate">
                  {role === "teacher" ? name : "Helper"}
                </span>
                {/* The status chip is the teacher's: the helper's call shows on its key. */}
                {screens.shown !== role && screens.calls(role) && (
                  <span
                    aria-hidden
                    data-testid={`terminal-screen-${role}-mark`}
                    className="size-2 shrink-0 rounded-full bg-highlight"
                  />
                )}
              </button>
            ))}
          </div>
        ) : (
          <span
            data-testid="teacher-panel-name"
            className="max-w-full truncate text-xl leading-snug font-medium text-ink"
          >
            {name}
          </span>
        )}
        {status && (
          <span
            data-testid="teacher-panel-agent"
            title={status}
            className={cn(
              "max-w-full truncate rounded-[10px] px-2.5 py-1 text-[14px] leading-5",
              needsYou ? "bg-highlight text-ink" : "bg-tone text-ink-2",
            )}
          >
            {status}
          </span>
        )}
      </div>
      {other && (
        <button
          type="button"
          data-testid="teacher-panel-view"
          aria-controls={bodyId}
          onClick={() => onView(other)}
          className={KEY}
        >
          {VIEW_LABEL[other]}
        </button>
      )}
      <button
        type="button"
        data-testid="teacher-panel-close"
        onClick={onClose}
        className={KEY}
      >
        <PixelIcon name="close" />
        Close
      </button>
    </div>
  );
}
