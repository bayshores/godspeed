import { memo } from "react";
import { SIGNATURE_MAX, type SignatureKind } from "@/shared/core";
import { SignatureText } from "@/frontend/components/space-page/head-signature";
import { FIELD } from "@/frontend/components/ui/field";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { Segmented } from "@/frontend/components/ui/segmented";

/**
 * Edit space's Signature field: the kind (Math / Code / Text), the one
 * line, and a preview in the space head's type.
 */

const KINDS: readonly { value: SignatureKind; label: string; placeholder: string }[] = [
	{ value: "math", label: "Math", placeholder: "LaTeX, for example \\binom{n}{k} = \\frac{n!}{k!(n-k)!}" },
	{ value: "code", label: "Code", placeholder: "For example int *p = &x;" },
	{ value: "text", label: "Text", placeholder: "For example a line from a source, a date" },
];

export const SpaceSignatureField = memo(function SpaceSignatureField({
	kind,
	value,
	disabled,
	onChange,
}: {
	kind: SignatureKind;
	value: string;
	disabled: boolean;
	onChange: (kind: SignatureKind, value: string) => void;
}) {
	const current = KINDS.find((k) => k.value === kind) ?? KINDS[0]!;
	const trimmed = value.trim();
	return (
		<div className="flex flex-col gap-1.5">
			<span className={LABEL_TEXT}>Signature</span>
			<div className="flex items-center gap-2">
				<Segmented label="Signature kind" testid="space-signature-kind" options={KINDS} value={kind} disabled={disabled} onChange={(next) => onChange(next, value)} />
				<input
					type="text"
					data-testid="space-signature"
					aria-label="Signature"
					value={value}
					maxLength={SIGNATURE_MAX}
					disabled={disabled}
					onChange={(e) => onChange(kind, e.target.value)}
					placeholder={current.placeholder}
					className={`${FIELD} min-w-0 flex-1`}
				/>
			</div>
			{trimmed && (
				<div data-testid="space-signature-preview" className="overflow-hidden rounded border border-border bg-background px-3 py-3 text-[26px] leading-none text-ink">
					<SignatureText signature={{ kind, value: trimmed }} />
				</div>
			)}
		</div>
	);
});
