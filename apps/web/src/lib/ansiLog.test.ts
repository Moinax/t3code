import { describe, expect, it } from "vite-plus/test";
import { parseAnsiLog } from "./ansiLog";

describe("parseAnsiLog", () => {
  it("renders the migration output's colors and resets without exposing escape codes", () => {
    const entries = parseAnsiLog("  \u001b[32m'2_OrchestrationCommandReceipts'\u001b[39m,\n");
    expect(entries.map((entry) => entry.text).join("")).toBe(
      "  '2_OrchestrationCommandReceipts',\n",
    );
    expect(entries[1]?.style.color).toContain("#86efac");
    expect(entries[2]?.style.color).toBeUndefined();
  });

  it("preserves combined decorations and extended foreground/background colors", () => {
    const entries = parseAnsiLog("\u001b[1;3;4;38;2;12;34;56;48;5;235mstyled\u001b[0mplain");
    expect(entries[0]).toMatchObject({
      text: "styled",
      style: {
        color: "rgb(12, 34, 56)",
        backgroundColor: "rgb(38, 38, 38)",
        fontWeight: 600,
        fontStyle: "italic",
        textDecoration: "underline",
      },
    });
    expect(entries[1]?.style.color).toBeUndefined();
    expect(entries[1]?.style.fontWeight).toBeUndefined();
  });

  it("removes terminal controls without losing the active color", () => {
    const entries = parseAnsiLog(
      "\u001b]0;Build title\u0007\u001b[32mfirst\r\n\u001b[2Ksecond\rthird" +
        "\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\\u001b[?25h\u001b[3",
    );
    expect(entries.map((entry) => entry.text).join("")).toBe("first\nsecond\nthirdlink");
    expect(entries.every((entry) => entry.style.color?.includes("#86efac"))).toBe(true);
  });

  it("keeps HTML-looking log output as literal text", () => {
    const text = '<script>alert("log")</script> & <build>';
    expect(
      parseAnsiLog(text)
        .map((entry) => entry.text)
        .join(""),
    ).toBe(text);
    expect(parseAnsiLog("")).toEqual([]);
  });
});
