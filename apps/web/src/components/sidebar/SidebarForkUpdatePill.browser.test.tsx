import type { ForkUpdateState } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render, type Screen } from "../../../test/render";
import { useForkMaintenance } from "../../state/forkMaintenance";
import { SidebarForkUpdatePill } from "./SidebarForkUpdatePill";

const { navigate, closeMobile } = vi.hoisted(() => ({ navigate: vi.fn(), closeMobile: vi.fn() }));
// Only `useNavigate` is ours to replace: the render helper imports the router
// itself from here, and a mock that drops its exports breaks the import.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
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

function setup(state: Partial<ForkUpdateState> = {}) {
  vi.clearAllMocks();
  localStorage.clear();
  useForkMaintenance.setState({ state: { ...job, ...state }, error: null, pending: false });
}

// The router module is mocked down to `useNavigate`, so the test router the
// render helper builds by default has nothing left to build with.
const pill = () => render(<SidebarForkUpdatePill />, { router: false });
const status = (screen: Screen) => screen.container.querySelector('[role="status"]')?.textContent;
const button = (screen: Screen, label: string) =>
  [...screen.container.querySelectorAll("button")].find((element) => element.textContent === label);

it("shows successive local build stages and opens activity from the mobile sidebar", async () => {
  setup();
  await using screen = await pill();
  expect(status(screen)).toBe("Local: running checks…");
  await act(() => useForkMaintenance.setState({ state: { ...job, stage: "building" } }));
  expect(status(screen)).toBe("Local: building app…");
  await act(() => screen.container.querySelector("button")!.click());
  expect(closeMobile).toHaveBeenCalledWith(false);
  expect(navigate).toHaveBeenCalledWith({ to: "/fork-updates" });
  await act(() => useForkMaintenance.setState({ state: { ...job, stage: "ready" } }));
  expect(screen.container.childElementCount).toBe(0);
});

it("shows upstream repair progress, then the failure, and goes quiet once it is nobody's problem", async () => {
  setup({ source: "upstream", stage: "repairing" });
  await using screen = await pill();
  expect(status(screen)).toBe("Fork: repairing changes…");
  // A failed run is the one terminal state worth interrupting for: nothing will
  // retry it on its own.
  await act(() => useForkMaintenance.setState({ state: { ...job, stage: "error" } }));
  expect(status(screen)).toBe("Fork update failed");
  for (const stage of ["cancelled", "idle"] as const) {
    await act(() => useForkMaintenance.setState({ state: { ...job, stage } }));
    expect(screen.container.childElementCount).toBe(0);
  }
});

it("offers the restart in place once an update is prepared", async () => {
  setup({ source: "upstream", stage: "ready", version: "new" });
  const request = vi.fn().mockResolvedValue(undefined);
  useForkMaintenance.setState({ request });
  await using screen = await pill();
  expect(status(screen)).toBe("Update ready");
  await act(() => button(screen, "Restart")!.click());
  expect(request).toHaveBeenCalledWith("restart");
  // Restarting is the action; it must not also navigate away from the thread.
  expect(navigate).not.toHaveBeenCalled();
});

it("announces an arrival once, and says nothing on a first ever run", async () => {
  setup({
    source: "upstream",
    stage: "idle",
    runningVersion: "1.0.0-moinax.new",
    targetTag: "v0.1.1-nightly.20261020.3411",
  });
  // Nothing remembered: there is no earlier build this can have arrived from.
  {
    await using first = await pill();
    expect(first.container.childElementCount).toBe(0);
    // Stored through the shared helpers, so the on-disk form is JSON.
    expect(localStorage.getItem("t3code.fork.seenVersion")).toBe('"1.0.0-moinax.new"');
  }

  localStorage.setItem("t3code.fork.seenVersion", '"1.0.0-moinax.old"');
  await using second = await pill();
  expect(status(second)).toBe("Now on v0.1.1-nightly.20261020.3411");
  await act(() => button(second, "Changes")!.click());
  expect(navigate).toHaveBeenCalledWith({ to: "/fork-updates" });
});
