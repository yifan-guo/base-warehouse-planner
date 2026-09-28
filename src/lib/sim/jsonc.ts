/** JSON with // and /* *\/ comments. Used so an operator can comment out a permit. */

export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inStr = false;
      i += 1;
      continue;
    }
    if (ch === "\"") {
      inStr = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function parseJsonc(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(stripJsonc(trimmed));
}

export function toggleLineComment(text: string, start: number, end: number): { text: string; start: number; end: number } {
  const from = Math.max(0, text.lastIndexOf("\n", Math.max(0, start - 1)) + 1);
  const to = end <= start ? text.indexOf("\n", end) : text.indexOf("\n", Math.max(end - 1, 0));
  const sliceEnd = to < 0 ? text.length : to;
  const block = text.slice(from, sliceEnd);
  const lines = block.split("\n");
  const allCommented = lines.every((line) => line.trim() === "" || /^\s*\/\//.test(line));
  const next = lines
    .map((line) => {
      if (line.trim() === "") return line;
      if (allCommented) return line.replace(/^(\s*)\/\/\s?/, "$1");
      const pad = line.match(/^\s*/)?.[0] ?? "";
      return `${pad}// ${line.slice(pad.length)}`;
    })
    .join("\n");
  return {
    text: text.slice(0, from) + next + text.slice(sliceEnd),
    start: from,
    end: from + next.length,
  };
}
