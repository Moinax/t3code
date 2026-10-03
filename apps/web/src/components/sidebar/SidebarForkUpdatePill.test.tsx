import type { ForkUpdateState } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useForkMaintenance } from "../../state/forkMaintenance";
import { SidebarForkUpdatePill } from "./SidebarForkUpdatePill";

const { navigate, closeMobile } = vi.hoisted(() => ({ navigate: vi.fn(), closeMobile: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("../ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: true, setOpenMobile: closeMobile }),
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => render,
  TooltipPopup: () => null,
}));
const job: ForkUpdateState = {
  available: true,
  source: "local",
  stage: "checking",
  message: "Checking desktop, web and server…",
  updatedAt: 1,
  commit: null,
  version: null,
  runningVersion: "old",
  runId: "run",
  workDir: "/tmp/build",
  attempt: 0,
  log: "",
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  useForkMaintenance.setState({ state: job, error: null, pending: false });
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});
it("shows successive local build stages and opens activity from the mobile sidebar", async () => {
  await act(() => {
    renderer = create(<SidebarForkUpdatePill />);
  });
  expect(renderer.root.findByProps({ role: "status" }).children).toEqual([
    "Local: running checks…",
  ]);
  await act(() => useForkMaintenance.setState({ state: { ...job, stage: "building" } }));
  expect(renderer.root.findByProps({ role: "status" }).children).toEqual(["Local: building app…"]);
  await act(() => renderer.root.findByType("button").props.onClick());
  expect(closeMobile).toHaveBeenCalledWith(false);
  expect(navigate).toHaveBeenCalledWith({ to: "/fork-updates" });
  await act(() => useForkMaintenance.setState({ state: { ...job, stage: "ready" } }));
  expect(renderer.toJSON()).toBeNull();
});
it("shows upstream repair progress and removes the banner when the operation stops", async () => {
  useForkMaintenance.setState({ state: { ...job, source: "upstream", stage: "repairing" } });
  await act(() => {
    renderer = create(<SidebarForkUpdatePill />);
  });
  expect(renderer.root.findByProps({ role: "status" }).children).toEqual([
    "Fork: repairing changes…",
  ]);
  for (const stage of ["error", "cancelled", "idle"] as const) {
    await act(() => useForkMaintenance.setState({ state: { ...job, stage } }));
    expect(renderer.toJSON()).toBeNull();
  }
});
