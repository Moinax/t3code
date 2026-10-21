import { describe, expect, it } from "vite-plus/test";

import { isAppModalPage, isSidebarUtilityPage } from "./mainAppLocation";

describe("isSidebarUtilityPage", () => {
  it.each(["/projects/project-1", "/pull-requests", "/fork-updates"])(
    "classifies %s as a utility page",
    (pathname) => {
      expect(isSidebarUtilityPage(pathname)).toBe(true);
    },
  );

  it.each(["/", "/threads/thread-1", "/settings", "/usage"])(
    "keeps %s as a main app page",
    (pathname) => {
      expect(isSidebarUtilityPage(pathname)).toBe(false);
    },
  );
});

describe("isAppModalPage", () => {
  it.each(["/settings", "/settings/providers", "/usage"])("opens %s as a modal", (pathname) => {
    expect(isAppModalPage(pathname)).toBe(true);
  });

  it("keeps /fork-updates as a page", () => {
    expect(isAppModalPage("/fork-updates")).toBe(false);
  });
});
