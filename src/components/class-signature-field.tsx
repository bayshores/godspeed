import { memo } from "react";
import { SIGNATURE_MAX, type SignatureKind } from "@/core";
import { SignatureText } from "@/components/overview/class-cover";

/**
 * Edit class's Signature field: the kind (Math / Code / Text), the one
 * line, and a preview in the cover's type.
 */

const KINDS: readonly { kind: SignatureKind; label: string; placeholder: string }[] = [
	{ kind: "math", label: "Math", placeholder: "LaTeX, e.g. \\binom{n}{k} = \\frac{n!}{k!(n-k)!}" },
	{ kind: "code", label: "Code", placeholder: "e.g. int *p = &x;" },
	{ kind: "text", label: "Text", placeholder: "e.g. a line from a source, a date" },
];

export const ClassSignatureField = memo(function ClassSignatureField({
	kind,
	value,
	disabled,
	labelClass,
	fieldClass,
	onChange,
}: {
	kind: SignatureKind;
	value: string;
	disabled: boolean;
	labelClass: string;
	fieldClass: string;
	onChange: (kind: SignatureKind, value: string) => void;
}) {
	const current = KINDS.find((k) => k.kind === kind) ?? KINDS[0]!;
	const trimmed = value.trim();
	return (
		<div className="mt-2.5 flex flex-col gap-1.5">
			<span className={labelClass}>Signature</span>
			<div className="flex gap-2">
				<select
					data-testid="class-signature-kind"
					aria-label="Signature kind"
					value={kind}
					disabled={disabled}
					onChange={(e) => onChange(e.target.value as SignatureKind, value)}
					className="shrink-0 border border-tone-2 bg-black px-2 text-[13px] text-ink-2 outline-none [color-scheme:dark] focus-visible:text-ink"
				>
					{KINDS.map((k) => (
						<option key={k.kind} value={k.kind}>
							{k.label}
						</option>
					))}
				</select>
				<input
					type="text"
					data-testid="class-signature"
					aria-label="Signature"
					value={value}
					maxLength={SIGNATURE_MAX}
					disabled={disabled}
					onChange={(e) => onChange(kind, e.target.value)}
					placeholder={current.placeholder}
					className={`h-10 ${fieldClass}`}
				/>
			</div>
			{trimmed && (
				<div data-testid="class-signature-preview" className="overflow-hidden bg-black px-3 py-3 text-[26px] leading-none text-ink">
					<SignatureText signature={{ kind, value: trimmed }} />
				</div>
			)}
		</div>
	);
});
