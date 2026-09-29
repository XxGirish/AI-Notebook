import katex from "katex";
import { Fragment, type ReactNode } from "react";

/**
 * Renders a chat answer. Model output is untrusted, so it is never inserted as
 * HTML: text becomes React text nodes, and only KaTeX's own output (with trust
 * disabled) is injected, the same restriction equation cards use.
 */

type Props = {
  text: string;
  /** Labels that were sent with the question, in the order they were sent. */
  citationIds: ReadonlySet<string>;
  activeCitation?: string;
  onCite?: (id: string) => void;
};

function MathSpan({ latex, display }: { latex: string; display: boolean }) {
  const html = katex.renderToString(latex, { throwOnError: false, trust: false, strict: "ignore", displayMode: display });
  return display
    ? <div className="chat-math chat-math--display" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="chat-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

const INLINE_PATTERN = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*\n]+\*\*|`[^`\n]+`|\[S[1-9][0-9]?\])/g;

function renderInline(text: string, props: Props, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("$$")) nodes.push(<MathSpan key={key} latex={token.slice(2, -2)} display={false} />);
    else if (token.startsWith("$")) nodes.push(<MathSpan key={key} latex={token.slice(1, -1)} display={false} />);
    else if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else {
      const id = token.slice(1, -1);
      if (props.citationIds.has(id)) {
        nodes.push(
          <button
            key={key}
            type="button"
            className="chat-cite"
            aria-pressed={props.activeCitation === id}
            aria-label={`Show source ${id.slice(1)}`}
            onClick={() => props.onCite?.(id)}
          >
            {id.slice(1)}
          </button>,
        );
      }
      // A label that was never sent is dropped rather than shown as a source.
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "heading"; text: string }
  | { kind: "math"; latex: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: Extract<Block, { kind: "list" }> | undefined;
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith("$$")) {
      endParagraph();
      endList();
      const collected = [trimmed.slice(2)];
      let closed = trimmed.length > 2 && trimmed.endsWith("$$");
      if (closed) collected[0] = collected[0].slice(0, -2);
      while (!closed && index + 1 < lines.length) {
        index += 1;
        const next = lines[index];
        if (next.trim().endsWith("$$")) {
          collected.push(next.trim().slice(0, -2));
          closed = true;
        } else {
          collected.push(next);
        }
      }
      blocks.push({ kind: "math", latex: collected.join("\n").trim() });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        endList();
        list = { kind: "list", ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }
    if (trimmed === "") {
      endParagraph();
      endList();
      continue;
    }
    endList();
    paragraph.push(trimmed);
  }
  endParagraph();
  endList();
  return blocks;
}

export function ChatMarkdown(props: Props) {
  return (
    <>
      {parseBlocks(props.text).map((block, index) => {
        const key = `block-${index}`;
        switch (block.kind) {
          case "math":
            return <MathSpan key={key} latex={block.latex} display />;
          case "heading":
            return <p key={key} className="chat-heading">{renderInline(block.text, props, key)}</p>;
          case "list": {
            const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, props, `${key}-${itemIndex}`)}</li>);
            return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
          }
          case "paragraph":
            return (
              <p key={key}>
                {block.lines.map((line, lineIndex) => (
                  <Fragment key={lineIndex}>
                    {lineIndex > 0 && <br />}
                    {renderInline(line, props, `${key}-${lineIndex}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </>
  );
}
