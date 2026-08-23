import * as React from "react";

type ResponseProps = React.HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
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

function ensureResponseStyles() {
  if (typeof document === "undefined" || document.getElementById("coden-response-styles")) return;
  const style = document.createElement("style");
  style.id = "coden-response-styles";
  style.textContent = `
    .coden-response {
      min-width: 0;
      overflow-wrap: anywhere;
      color: var(--text);
      font-size: 13px;
      line-height: 1.68;
    }

    .coden-response > *:first-child { margin-top: 0 !important; }
    .coden-response > *:last-child { margin-bottom: 0 !important; }

    .coden-response p {
      margin: 0 0 10px;
      white-space: pre-wrap;
    }

    .coden-response h1,
    .coden-response h2,
    .coden-response h3,
    .coden-response h4 {
      margin: 14px 0 8px;
      color: var(--text);
      letter-spacing: -0.02em;
      line-height: 1.18;
    }

    .coden-response h1 { font-size: 21px; }
    .coden-response h2 { font-size: 18px; }
    .coden-response h3 { font-size: 15px; }
    .coden-response h4 { font-size: 14px; }

    .coden-response strong {
      color: var(--text);
      font-weight: 780;
    }

    .coden-response em {
      color: var(--text-muted);
      font-style: italic;
    }

    .coden-response a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
    }

    .coden-response code {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg-input) 92%, transparent);
      color: var(--text);
      padding: 1px 5px;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }

    .coden-response pre {
      margin: 10px 0;
      overflow: auto;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg-input) 92%, #020617 8%);
      padding: 12px;
      color: var(--text);
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 4%, transparent);
    }

    .coden-response pre code {
      display: block;
      border: 0;
      border-radius: 0;
      background: transparent;
      padding: 0;
      white-space: pre;
      line-height: 1.6;
    }

    .coden-response blockquote {
      margin: 10px 0;
      border-left: 3px solid var(--accent);
      padding: 8px 0 8px 12px;
      color: var(--text-muted);
      background: color-mix(in srgb, var(--accent-dim) 46%, transparent);
      border-radius: 0 10px 10px 0;
    }

    .coden-response ul,
    .coden-response ol {
      margin: 8px 0 12px;
      padding-left: 22px;
      display: grid;
      gap: 5px;
    }

    .coden-response li {
      padding-left: 2px;
    }

    .coden-response hr {
      height: 1px;
      border: 0;
      background: var(--border);
      margin: 14px 0;
    }

    .coden-response-table-wrap {
      max-width: 100%;
      overflow: auto;
      margin: 10px 0 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
    }

    .coden-response table {
      width: 100%;
      min-width: 360px;
      border-collapse: collapse;
      background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
      font-size: 12px;
    }

    .coden-response th,
    .coden-response td {
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }

    .coden-response th {
      color: var(--text);
      background: color-mix(in srgb, var(--bg-input) 82%, transparent);
      font-weight: 760;
    }

    .coden-response tr:last-child td {
      border-bottom: 0;
    }

    .coden-response-math {
      display: inline-flex;
      max-width: 100%;
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--bg-input) 86%, transparent);
      color: var(--text);
      padding: 6px 9px;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      white-space: pre;
    }

    .coden-response-cursor {
      display: inline-block;
      width: 0.55ch;
      height: 1.05em;
      margin-left: 2px;
      border-radius: 2px;
      background: color-mix(in srgb, var(--text) 64%, transparent);
      transform: translateY(2px);
      animation: coden-response-caret 1s steps(2, start) infinite;
    }

    @keyframes coden-response-caret {
      50% { opacity: 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .coden-response-cursor { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

function parseTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell => cell.trim());
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

    const fence = line.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (fence) {
      flushAll();
      const language = fence[1] || "text";
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
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

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\$[^$\n]+\$|`[^`]+`|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\n]+?\*|_[^_\n]+?_|https?:\/\/[^\s<)]+|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}_${token.length}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2))}</strong>);
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1))}</em>);
    } else if (token.startsWith("$") && token.endsWith("$")) {
      nodes.push(<span className="coden-response-math" key={key}>{token.slice(1, -1)}</span>);
    } else if (token.startsWith("[")) {
      const labelEnd = token.indexOf("](");
      const label = token.slice(1, labelEnd);
      const href = token.slice(labelEnd + 2, -1);
      nodes.push(<a href={href} key={key} rel="noreferrer" target="_blank">{label}</a>);
    } else {
      nodes.push(<a href={token} key={key} rel="noreferrer" target="_blank">{token}</a>);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes.length ? nodes : [text];
}

function renderBlock(block: Block, index: number) {
  if (block.type === "heading") {
    if (block.level === 1) return <h1 key={index}>{renderInline(block.text)}</h1>;
    if (block.level === 2) return <h2 key={index}>{renderInline(block.text)}</h2>;
    if (block.level === 3) return <h3 key={index}>{renderInline(block.text)}</h3>;
    return <h4 key={index}>{renderInline(block.text)}</h4>;
  }
  if (block.type === "paragraph") return <p key={index}>{renderInline(block.text)}</p>;
  if (block.type === "quote") return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
  if (block.type === "hr") return <hr key={index} />;
  if (block.type === "math") return <div className="coden-response-math" key={index}>{block.text}</div>;
  if (block.type === "code") {
    return (
      <pre key={index}>
        <code data-language={block.language}>{block.code}</code>
      </pre>
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag key={index}>
        {block.items.map((item, itemIndex) => <li key={`${itemIndex}_${item.slice(0, 18)}`}>{renderInline(item)}</li>)}
      </Tag>
    );
  }
  if (block.type === "table") {
    const [head = [], ...body] = block.rows;
    return (
      <div className="coden-response-table-wrap" key={index}>
        <table>
          <thead>
            <tr>{head.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {head.map((_, cellIndex) => <td key={cellIndex}>{renderInline(row[cellIndex] || "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

export const Response = React.memo(function Response({ children, className = "", ...props }: ResponseProps) {
  React.useEffect(ensureResponseStyles, []);
  const content = React.useMemo(() => React.Children.toArray(children).join(""), [children]);
  const blocks = React.useMemo(() => parseBlocks(content), [content]);
  const isLikelyStreaming = content.length > 0 && !/[.!?。！？)\]}`'"]\s*$/.test(content.trim());

  return (
    <div className={`coden-response ${className}`} {...props}>
      {blocks.length ? blocks.map(renderBlock) : <p>{content}</p>}
      {isLikelyStreaming ? <span className="coden-response-cursor" aria-hidden="true" /> : null}
    </div>
  );
});

export default Response;
