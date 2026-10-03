import Anser from "anser";
import type { CSSProperties } from "react";

// Keep the basic terminal colors readable on both light and dark app backgrounds.
const colors: Record<string, string> = {
  "0,0,0": "light-dark(#18181b, #a1a1aa)",
  "187,0,0": "light-dark(#b91c1c, #f87171)",
  "0,187,0": "light-dark(#15803d, #86efac)",
  "187,187,0": "light-dark(#a16207, #fde047)",
  "0,0,187": "light-dark(#1d4ed8, #93c5fd)",
  "187,0,187": "light-dark(#a21caf, #e879f9)",
  "0,187,187": "light-dark(#0e7490, #67e8f9)",
  "255,255,255": "var(--foreground)",
  "85,85,85": "var(--muted-foreground)",
  "255,85,85": "light-dark(#dc2626, #fca5a5)",
  "0,255,0": "light-dark(#15803d, #bbf7d0)",
  "255,255,85": "light-dark(#a16207, #fef08a)",
  "85,85,255": "light-dark(#2563eb, #bfdbfe)",
  "255,85,255": "light-dark(#a21caf, #f5d0fe)",
  "85,255,255": "light-dark(#0e7490, #a5f3fc)",
};

function color(value: string | null) {
  return value ? (colors[value.replaceAll(" ", "")] ?? `rgb(${value})`) : undefined;
}

/** Parse terminal styling as React text spans, never as HTML from command output. */
export function parseAnsiLog(log: string) {
  const input = log
    .replace(/\r\n?/g, "\n")
    .replace(/\u009b/g, "\u001b[")
    // Discard terminal titles, hyperlinks, cursor commands and incomplete trailing escapes.
    // eslint-disable-next-line no-control-regex -- ANSI sequences begin with terminal control bytes.
    .replace(/\u001b(?:\][\s\S]*?(?:\u0007|\u001b\\|$)|\[[0-?]*[ -/]*[@-~]?)/g, (code) =>
      // eslint-disable-next-line no-control-regex -- Preserve only complete SGR color/style sequences.
      /^\u001b\[[\d;]*m$/.test(code) ? code : "",
    );
  let offset = 0;
  return Anser.ansiToJson(input, { remove_empty: true }).map((entry) => {
    const start = offset;
    offset += entry.content.length;
    const decorations = entry.decorations;
    const style: CSSProperties = {
      color: color(entry.fg),
      backgroundColor: color(entry.bg),
      fontWeight: decorations.includes("bold") ? 600 : undefined,
      fontStyle: decorations.includes("italic") ? "italic" : undefined,
      opacity: decorations.includes("dim") ? 0.7 : undefined,
      textDecoration:
        [
          decorations.includes("underline") ? "underline" : "",
          decorations.includes("strikethrough") ? "line-through" : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
    };
    return { offset: start, text: entry.content, style };
  });
}
