import { describe, expect, it } from "vite-plus/test";

import { isSidebarUtilityPage } from "./mainAppLocation";

describe("isSidebarUtilityPage", () => {
  it.each([
    "/settings",
    "/settings/providers",
    "/projects/project-1",
    "/usage",
    "/pull-requests",
    "/fork-updates",
  ])("classifies %s as a utility page", (pathname) => {
    expect(isSidebarUtilityPage(pathname)).toBe(true);
  });

  it.each(["/", "/threads/thread-1"])("keeps %s as a main app page", (pathname) => {
    expect(isSidebarUtilityPage(pathname)).toBe(false);
  });
});
