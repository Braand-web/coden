import * as React from "react";

type ResponseProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  isStreaming?: boolean;
};

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; code: string }
  | { type: "table"; rows: string[][] }
  | { type: "math"; text: string }
  | { type: "hr" };

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value, typeof window === "undefined" ? "https://coden.invalid" : window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

function parseTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  return cells.length > 1 ? cells : null;
}

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function parseBlocks(markdown: string): Block[] {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let index = 0;
  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  while (index < lines.length) {
    const raw = lines[index] || "";
    const line = raw.trim();
    if (!line) {
      flushAll();
      index += 1;
      continue;
    }
    const fence = line.match(/^\`\`\`([a-zA-Z0-9_-]+)?\s*$/);
    if (fence) {
      flushAll();
      const language = fence[1] || "text";
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^\`\`\`\s*$/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language, code: code.join("\n") });
      continue;
    }
    if (line === "---" || line === "***") {
      flushAll();
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    if (line === "$$") {
      flushAll();
      index += 1;
      const math: string[] = [];
      while (index < lines.length && lines[index].trim() !== "$$") {
        math.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "math", text: math.join("\n").trim() });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (line.startsWith(">")) {
      flushAll();
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n").trim() });
      continue;
    }
    const tableHeader = parseTableRow(raw);
    if (tableHeader && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushAll();
      const rows = [tableHeader];
      index += 2;
      while (index < lines.length) {
        const row = parseTableRow(lines[index]);
        if (!row) break;
        rows.push(row);
        index += 1;
      }
      blocks.push({ type: "table", rows });
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      if (list && list.ordered !== orderedList) flushList();
      if (!list) list = { ordered: orderedList, items: [] };
      list.items.push((unordered?.[1] || ordered?.[1] || "").trim());
      index += 1;
      continue;
    }
    flushList();
    paragraph.push(raw);
    index += 1;
  }
  flushAll();
  return blocks;
}

/*
 * What a half-written reply should look like.
 *
 * A reply arrives a few characters at a time, so for most of its life the
 * last word is inside markup that has not been closed yet: `**import`,
 * `` `npm i ``, `[la doc](https://`. Parsed as it stands, every one of those
 * shows its raw syntax for a moment and then snaps into formatting when the
 * closing marker lands — the asterisks flicker on and off at the end of the
 * line. While streaming, the unmatched opener at the tail is set aside
 * instead: the words appear plain, then turn bold once the pair is complete.
 *
 * Only the tail is touched, and only while streaming; the finished message is
 * parsed exactly as it was written.
 */
export function settleStreamingMarkdown(value: string): string {
  let text = String(value || "");
  // A last line that is nothing but a block marker so far ("##", "-", "1.").
  text = text.replace(/(^|\n)[ \t]*(#{1,4}|[-*+]|\d+[.)])[ \t]*$/, "$1");
  // An opening fence with no body yet.
  text = text.replace(/(^|\n)[ \t]*`{1,3}[a-zA-Z0-9_-]*[ \t]*$/, "$1");
  const fences = (text.match(/^[ \t]*```/gm) || []).length;
  if (fences % 2 === 1) return text; // inside a code block: leave it verbatim.
  const lastLine = text.slice(text.lastIndexOf("\n") + 1);
  // A list bullet ("* item") is structure, not an unmatched emphasis marker.
  const prefix = lastLine.match(/^[ \t]*(?:[*+-]|\d+[.)]|#{1,4}|>)[ \t]+/)?.[0] ?? "";
  let tail = lastLine.slice(prefix.length);
  // A link whose target is still arriving: show its label only.
  tail = tail.replace(/\[([^\]\n]*)\]\([^)\n]*$/, "$1");
  // A link whose label is still arriving.
  tail = tail.replace(/\[([^\]\n]*)$/, "$1");
  const unmatched = (marker: string) => {
    const escaped = marker.replace(/[*_`]/g, "\\$&");
    return ((tail.match(new RegExp(escaped, "g")) || []).length) % 2 === 1;
  };
  const dropLast = (marker: string) => {
    const index = tail.lastIndexOf(marker);
    if (index >= 0) tail = tail.slice(0, index) + tail.slice(index + marker.length);
  };
  if (unmatched("`")) dropLast("`");
  if (unmatched("**")) dropLast("**");
  if (unmatched("__")) dropLast("__");
  const singles = tail.replace(/\*\*/g, "").replace(/__/g, "");
  if (((singles.match(/\*/g) || []).length) % 2 === 1) { const at = tail.lastIndexOf("*"); if (at >= 0 && tail[at - 1] !== "*" && tail[at + 1] !== "*") tail = tail.slice(0, at) + tail.slice(at + 1); }
  if (((singles.match(/(^|[\s(])_(?=\S)/g) || []).length) % 2 === 1) { const at = tail.search(/(^|[\s(])_(?=\S)(?!.*(^|[\s(])_(?=\S))/); if (at >= 0) { const underscore = tail.indexOf("_", at); tail = tail.slice(0, underscore) + tail.slice(underscore + 1); } }
  return text.slice(0, text.length - lastLine.length) + prefix + tail;
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\$[^$\n]+\$|\`[^\`]+\`|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\n]+?\*|_[^_\n]+?_|https?:\/\/[^\s<)]+|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}_${token.length}`;
    if (token.startsWith("\`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) nodes.push(<strong key={key}>{renderInline(token.slice(2, -2))}</strong>);
    else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) nodes.push(<em key={key}>{renderInline(token.slice(1, -1))}</em>);
    else if (token.startsWith("$") && token.endsWith("$")) nodes.push(<span className="coden-response-math is-inline" key={key}>{token.slice(1, -1)}</span>);
    else {
      const markdownLink = token.startsWith("[");
      const labelEnd = markdownLink ? token.indexOf("](") : -1;
      const label = markdownLink ? token.slice(1, labelEnd) : token;
      const rawHref = markdownLink ? token.slice(labelEnd + 2, -1) : token;
      const href = safeExternalUrl(rawHref);
      nodes.push(href ? <a href={href} key={key} rel="noopener noreferrer" target="_blank">{label}</a> : <span key={key}>{label}</span>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : [text];
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="coden-response-code-block">
      <div className="coden-response-code-header"><span>{language}</span><button type="button" onClick={copy}>{copied ? "Copié" : "Copier"}</button></div>
      <pre><code data-language={language}>{code}</code></pre>
    </div>
  );
}

function renderBlock(block: Block, index: number, tail: React.ReactNode = null) {
  if (block.type === "heading") {
    if (block.level === 1) return <h1 key={index}>{renderInline(block.text)}{tail}</h1>;
    if (block.level === 2) return <h2 key={index}>{renderInline(block.text)}{tail}</h2>;
    if (block.level === 3) return <h3 key={index}>{renderInline(block.text)}{tail}</h3>;
    return <h4 key={index}>{renderInline(block.text)}{tail}</h4>;
  }
  if (block.type === "paragraph") return <p key={index}>{renderInline(block.text)}{tail}</p>;
  if (block.type === "quote") return <blockquote key={index}>{renderInline(block.text)}{tail}</blockquote>;
  if (block.type === "hr") return <hr key={index} />;
  if (block.type === "math") return <div className="coden-response-math" key={index}>{block.text}</div>;
  if (block.type === "code") return <CodeBlock code={block.code} language={block.language} key={index} />;
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    // Keyed by position: keying on the item's text remounted the item being
    // written on every keystroke while it was still short.
    return <Tag key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}{itemIndex === block.items.length - 1 ? tail : null}</li>)}</Tag>;
  }
  if (block.type === "table") {
    const [head = [], ...body] = block.rows;
    return <div className="coden-response-table-wrap" key={index}><table><thead><tr>{head.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead><tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{head.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] || "")}</td>)}</tr>)}</tbody></table></div>;
  }
  return null;
}

export const Response = React.memo(function Response({ children, className = "", isStreaming = false, ...props }: ResponseProps) {
  const raw = React.useMemo(() => React.Children.toArray(children).join(""), [children]);
  const content = React.useMemo(() => (isStreaming ? settleStreamingMarkdown(raw) : raw), [raw, isStreaming]);
  const blocks = React.useMemo(() => parseBlocks(content), [content]);
  /*
   * The caret sits at the end of the text, not under it.
   *
   * It was a sibling of the blocks, so after the first paragraph it wrapped
   * onto a line of its own below the reply and the text appeared to be typed
   * one line above the cursor. It now goes inside the last block that can
   * hold inline content; after a table, a code block or a rule it stays where
   * it was.
   */
  const cursor = isStreaming ? <span className="coden-response-cursor" aria-hidden="true" /> : null;
  const last = blocks[blocks.length - 1];
  const inlineTail = Boolean(cursor && last && ["heading", "paragraph", "quote", "list"].includes(last.type));
  return (
    <div className={`coden-response ${className}`} data-streaming={isStreaming} {...props}>
      {blocks.length
        ? blocks.map((block, index) => renderBlock(block, index, inlineTail && index === blocks.length - 1 ? cursor : null))
        : content ? <p>{content}{cursor}</p> : null}
      {cursor && !inlineTail && blocks.length ? <span className="coden-response-cursor is-block" aria-hidden="true" /> : null}
    </div>
  );
});

export default Response;
