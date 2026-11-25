import { LoadingLine } from "@/frontend/components/loading";
import { useMcpAccess } from "@/frontend/components/agent-status";
import { CopyButton } from "@/frontend/components/copy-button";
import { ACCESS_ERROR, maskToken } from "@/frontend/components/mcp-access";
import { QUIET_KEY } from "@/frontend/components/settings/controls";

/** Any other MCP app: the address and the access token to paste into it. */
export function OtherAppSetup() {
	const { access, failed } = useMcpAccess();
	if (!access) return failed ? <p className="text-[15px] text-ink-2">{ACCESS_ERROR}</p> : <LoadingLine className="text-[15px]" />;
	return (
		<div className="flex w-full flex-col gap-3 text-left">
			<p className="text-[15px] text-ink-2">
				Add a Streamable HTTP MCP server with this address and header, then ask your app to teach you with the godspeed tools. Let it use
				them without asking your permission.
			</p>
			<div className="lh-well rounded">
				<div className="flex items-center justify-between px-4 py-2.5">
					<span className="text-[15px] text-ink-2">MCP server</span>
					<CopyButton
						text={`${access.url}\nAuthorization: Bearer ${access.token}`}
						aria-label="Copy MCP server"
						className={QUIET_KEY}
					/>
				</div>
				<pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-[1.9] text-ink">
					{access.url}
					{"\n"}Authorization: Bearer {maskToken(access.token)}
				</pre>
			</div>
		</div>
	);
}
