import { blurAfterPointerClick } from "@/components/focus-hygiene";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import type { ComponentProps } from "react";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { transformMathDelimiters } from "@/core";
import { streamdownPlugins } from "./message";
import { mdComponents } from "@/components/md-blocks";
import { Shimmer } from "./shimmer";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

type ReasoningProps = Omit<ComponentProps<typeof Collapsible>, "open" | "defaultOpen" | "onOpenChange"> & {
  isStreaming?: boolean;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    children,
    ...props
  }: ReasoningProps) => {
    // Collapsed by default, even while streaming: opening is always the
    // learner's click, and the auto-close after the stream still tidies a
    // row the learner had opened.
    const [isOpen, setIsOpen] = useState(false);
    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);

    // Auto-close when streaming ends (once only, and only if it ever streamed)
    useEffect(() => {
      if (
        hasEverStreamedRef.current &&
        !isStreaming &&
        isOpen &&
        !hasAutoClosed
      ) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, hasAutoClosed]);

    const contextValue = useMemo(
      () => ({ isOpen, isStreaming }),
      [isOpen, isStreaming]
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose mb-4", className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);

type ReasoningTriggerProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "children">;

export const ReasoningTrigger = memo(
  ({
    className,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          /* The heading register: the small mono caps of the card
             eyebrows, matching YOUR THINKING, whose rail offsets it by
             exactly the character difference. */
          "flex w-full items-center gap-2 text-muted-foreground text-xs font-semibold transition-colors duration-(--lh-dur) ease-(--lh-ease-out) hover:text-foreground",
          className
        )}
        {...props}
        /* FOCUS HYGIENE: a pointer click
           on the thinking toggle must not leave focus here — the learner's
           next Enter submits, it must not re-toggle. Radix composes this
           with its own toggle handler. */
        onClick={(e) => blurAfterPointerClick(e)}
      >
        {/* The spinner shows while streaming only: motion is the signal.
            It is the placeholder spinner's size, so the handoff is seamless. */}
        {isStreaming && <BrailleSpinner label="Thinking" />}
        {/* A static settled label, pairing with the learner's "Your thinking" rows. */}
        {isStreaming ? <Shimmer>Thinking...</Shimmer> : <p>AGENT’S THINKING</p>}
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform duration-(--lh-dur) ease-(--lh-ease-out)",
            isOpen ? "rotate-180" : "rotate-0"
          )}
        />
      </CollapsibleTrigger>
    );
  }
);

type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};

// Shares message.tsx's Streamdown config (math delimiters, dark mermaid,
// remark-breaks) — reasoning renders the same contract as message text.

export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-4 text-sm text-muted-foreground outline-none",
        /* The app's motion tokens (tw-animate is not loaded). Opening
           rises in; closing fades, and Radix waits for it before unmounting. */
        "motion-safe:data-[state=open]:animate-[lh-rise-in_var(--lh-dur)_var(--lh-ease-out)] motion-safe:data-[state=closed]:animate-[lh-fade-out_var(--lh-dur-fast)_var(--lh-ease-in)_both]",
        className
      )}
      {...props}
    >
      <Streamdown components={mdComponents} plugins={streamdownPlugins}>
        {transformMathDelimiters(children)}
      </Streamdown>
    </CollapsibleContent>
  )
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
