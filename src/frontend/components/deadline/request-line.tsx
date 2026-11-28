import { JobFailure } from "@/frontend/components/agent-setup/agent-card";
import { cn } from "@/frontend/lib/utils";

/** What went wrong with a request to the teacher (the line `requestFailedLine` words). */
export function RequestLine({ line, className = "text-ui" }: { line: string; className?: string }) {
	return (
		<JobFailure>
			<p role="alert" data-testid="deadline-request-line" className={cn(className, "text-ink")}>
				{line}
			</p>
		</JobFailure>
	);
}
