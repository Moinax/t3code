import { Children, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native-svg", () => ({
  default: "svg",
  Circle: "circle",
  Defs: "defs",
  LinearGradient: "linearGradient",
  Path: "path",
  Stop: "stop",
}));

import { SourceControlIcon } from "./SourceControlIcon";

describe("SourceControlIcon", () => {
  it("renders the official Forgejo mark at the requested size", () => {
    const icon = SourceControlIcon({ kind: "forgejo", size: 24 }) as ReactElement<{
      width: number;
      height: number;
      viewBox: string;
      children: ReactNode;
    }>;

    expect(icon.props).toMatchObject({
      width: 24,
      height: 24,
      viewBox: "0 0 212 212",
    });
    expect(Children.count(icon.props.children)).toBe(5);
  });
});
