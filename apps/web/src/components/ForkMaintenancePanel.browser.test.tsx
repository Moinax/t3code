import type { ForkUpdateState } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { act, render as mount, stubGlobal, type Screen } from "../../test/render";
import { useForkMaintenance } from "../state/forkMaintenance";
import { useForkUpdatesStore } from "../state/forkUpdates";
import { ForkMaintenancePanel } from "./ForkMaintenancePanel";

const prepared: ForkUpdateState = {
  available: true,
  stage: "ready",
  source: "upstream",
  message: "Update installed. Restart when you are ready.",
  updatedAt: 1,
  commit: "abc123",
  version: "1.0.0-moinax.abc123",
  preparedVersion: "1.0.0-moinax.abc123",
  preparedSource: "upstream",
  runningVersion: "1.0.0-moinax.previous",
  runId: "upstream-run",
  workDir: "/tmp/candidate",
  attempt: 0,
  log: "",
};
const bridge = vi.fn();
let screen: Screen | undefined;
let container: HTMLElement;

function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function localButtons() {
  const heading = [...container.querySelectorAll("h3")].find(
    (node) => node.textContent === "Local changes",
  );
  return [...heading!.parentElement!.parentElement!.querySelectorAll("button")];
}

/** Mounts the panel on the first call and re-renders it on later ones. */
async function render() {
  if (screen) return screen.rerender(<ForkMaintenancePanel />);
  screen = await mount(<ForkMaintenancePanel />);
  container = screen.container;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

/** One test's panel: fresh state and a stubbed desktop bridge, both gone on dispose. */
function panel(): AsyncDisposable {
  bridge.mockReset();
  useForkMaintenance.setState({ state: prepared, pending: false, error: null });
  const desktopBridge = stubGlobal("desktopBridge", { forkUpdate: bridge });
  return {
    async [Symbol.asyncDispose]() {
      try {
        await screen?.[Symbol.asyncDispose]();
      } finally {
        screen = undefined;
        desktopBridge[Symbol.dispose]();
      }
    },
  };
}

it("updates the fork and offers restart without another local installation", async () => {
  await using _panel = panel();
  useForkMaintenance.setState({ state: { ...prepared, runningVersion: prepared.version! } });
  await render();
  bridge.mockResolvedValue({ ...prepared, stage: "fetching" });
  await click("Update fork");
  expect(bridge).toHaveBeenLastCalledWith("start");
  expect(button("Cancel update").disabled).toBe(false);
  const next = {
    ...prepared,
    preparedVersion: "next",
    version: "next",
    localBuildStatus: "up-to-date",
  };
  bridge.mockResolvedValue(next);
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Up to date").disabled).toBe(true);
  bridge.mockResolvedValue({ ...next, runningVersion: "next" });
  await click("Restart");
  expect(bridge).toHaveBeenLastCalledWith("restart");
  expect(button("Update fork").disabled).toBe(false);
  expect(button("Up to date").disabled).toBe(true);
});

it("builds local changes while upstream is ready and offers the resulting local version to restart", async () => {
  await using _panel = panel();
  await render();
  expect(button("Install local changes").disabled).toBe(false);
  expect(button("Restart").disabled).toBe(false);
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    stage: "snapshotting",
    runId: "local-run",
  });
  await click("Install local changes");
  expect(bridge).toHaveBeenLastCalledWith("start-local");
  expect(container.querySelector("h2")?.textContent).toBe("Installing local changes");
  expect(button("Cancel installation").disabled).toBe(false);
  expect(button("Restart").disabled).toBe(true);

  const localVersion = "1.0.0-moinax.local.123456789";
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    preparedSource: "local",
    version: localVersion,
    preparedVersion: localVersion,
  });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(container.querySelector("h2")?.textContent).toBe("Ready to restart");
  expect(useForkMaintenance.getState().state?.preparedVersion).toBe(localVersion);
  await click("Restart");
  expect(bridge).toHaveBeenLastCalledWith("restart");
});

it("keeps the previous restart available after cancelling a local build", async () => {
  await using _panel = panel();
  useForkMaintenance.setState({ state: { ...prepared, source: "local", stage: "building" } });
  await render();
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    stage: "cancelled",
    message: "Build cancelled.",
  });
  await click("Cancel installation");
  expect(bridge).toHaveBeenLastCalledWith("cancel");
  expect(button("Retry installation").disabled).toBe(false);
  expect(button("Restart").disabled).toBe(false);
  expect(useForkMaintenance.getState().state?.preparedVersion).toBe(prepared.version);
  await click("Restart");
  expect(bridge).toHaveBeenLastCalledWith("restart");
});

it("disables a matching local build, enables it after edits, and disables it again after reverting", async () => {
  await using _panel = panel();
  useForkMaintenance.setState({
    state: { ...prepared, source: "local", localBuildStatus: "up-to-date" },
  });
  await render();
  expect(button("Up to date").disabled).toBe(true);
  expect(button("Restart").disabled).toBe(false);
  bridge.mockResolvedValue({ ...prepared, source: "local", localBuildStatus: "changed" });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Install local changes").disabled).toBe(false);
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    localBuildStatus: "up-to-date",
    runningVersion: prepared.version,
  });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Up to date").disabled).toBe(true);
  expect(
    [...container.querySelectorAll("button")].some((item) => item.textContent === "Restart"),
  ).toBe(false);
});

it("uses one local action from installation through restart to up to date", async () => {
  await using _panel = panel();
  const initial: ForkUpdateState = {
    ...prepared,
    source: "local",
    preparedSource: "local",
    runningVersion: prepared.version!,
    localBuildStatus: "changed",
  };
  useForkMaintenance.setState({ state: initial });
  await render();
  expect(localButtons()).toHaveLength(1);
  bridge.mockResolvedValue({ ...initial, stage: "building" });
  await click("Install local changes");
  expect(bridge).toHaveBeenLastCalledWith("start-local");
  expect(button("Cancel installation").disabled).toBe(false);
  expect(localButtons()).toHaveLength(1);
  bridge.mockResolvedValue({ ...initial, stage: "installing" });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Installing…").disabled).toBe(true);
  const next = {
    ...initial,
    version: "new-local-build",
    preparedVersion: "new-local-build",
    localBuildStatus: "up-to-date",
  };
  bridge.mockResolvedValue(next);
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Restart").disabled).toBe(false);
  expect(localButtons()).toHaveLength(1);
  bridge.mockResolvedValue({ ...next, runningVersion: "new-local-build" });
  await click("Restart");
  expect(bridge).toHaveBeenLastCalledWith("restart");
  expect(button("Up to date").disabled).toBe(true);
  expect(localButtons()).toHaveLength(1);
});

it("keeps restart as the local action when more files change after preparation", async () => {
  await using _panel = panel();
  useForkMaintenance.setState({
    state: { ...prepared, source: "local", preparedSource: "local", localBuildStatus: "changed" },
  });
  await render();
  expect(localButtons()).toHaveLength(1);
  expect(button("Restart").disabled).toBe(false);
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    preparedSource: "local",
    stage: "cancelled",
    localBuildStatus: "changed",
  });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Restart").disabled).toBe(false);
});

it("offers the rollback only when there is a build to go back to, named or not", async () => {
  await using _panel = panel();
  // Absent key: no backup on disk, so the section would promise a recovery the
  // runner cannot perform.
  await render();
  expect([...container.querySelectorAll("h3")].map((node) => node.textContent)).not.toContain(
    "Go back a build",
  );

  // Present but null: a copy left by `t3fork install`, which does not know what
  // it replaced. Restorable, so the section must still appear.
  useForkMaintenance.setState({ state: { ...prepared, rollbackVersion: null } });
  await render();
  expect(container.textContent).toContain("Restores the previous build");

  useForkMaintenance.setState({
    state: { ...prepared, rollbackVersion: "1.0.0-moinax.previous" },
  });
  await render();
  expect(container.textContent).toContain("Restores 1.0.0-moinax.previous");
  bridge.mockResolvedValue({ ...prepared, stage: "idle" });
  await click("Roll back");
  expect(bridge).toHaveBeenCalledWith("rollback");
});

it("says what starting a run would accomplish, and stands down when it is nothing", async () => {
  await using _panel = panel();
  const upstream = (count: number) =>
    useForkUpdatesStore.setState({
      data: {
        count,
        commits: [],
        checkedAt: 1,
        nightly: { tag: "v0.1.1", commit: "a".repeat(40), publishedAt: null, eligibleAt: null },
        compareUrl: "https://github.com/Moinax/t3code/compare/x",
      },
    });
  const idle: ForkUpdateState = {
    ...prepared,
    stage: "idle",
    version: null,
    runningVersion: "1.0.0-moinax.abc123",
  };

  // Commits waiting upstream: the ordinary call to action.
  upstream(7);
  useForkMaintenance.setState({ state: idle });
  await render();
  expect(button("Update fork").className).not.toContain("border-input");

  // Nothing upstream, but work of this machine's own that nothing else ships —
  // the upstream count compares published branches and cannot see it.
  upstream(0);
  useForkMaintenance.setState({ state: { ...idle, unpublishedCommits: 8 } });
  await render();
  expect(container.textContent).toContain("8 fork commits are not published yet");
  button("Rebuild and publish");

  // Nothing at all: still reachable, no longer the loudest thing on the page.
  useForkMaintenance.setState({ state: { ...idle, unpublishedCommits: 0 } });
  await render();
  expect(container.textContent).not.toContain("not published yet");
  expect(button("Rebuild from upstream").className).toContain("border-input");

  // And before GitHub has answered, nobody knows: keep the neutral label.
  useForkUpdatesStore.setState({ data: null });
  await render();
  button("Update fork");
});

it("names the run after what it would do, and refuses it when it would fail", async () => {
  await using _panel = panel();
  const idle: ForkUpdateState = {
    ...prepared,
    stage: "idle",
    version: null,
    runningVersion: "1.0.0-moinax.abc123",
    unpublishedCommits: 0,
    localClean: true,
  };
  useForkUpdatesStore.setState({
    data: {
      count: 0,
      commits: [],
      checkedAt: 1,
      nightly: { tag: "v0.1.1", commit: "a".repeat(40), publishedAt: null, eligibleAt: null },
      compareUrl: "https://github.com/Moinax/t3code/compare/x",
    },
  });

  // Nothing upstream, nothing unpublished, and the running build is the
  // checkout's head: the run short-circuits without building, so say so.
  useForkMaintenance.setState({ state: { ...idle, runningIsHead: true } });
  await render();
  expect(button("Check for an update").disabled).toBe(false);

  // Same, except the running build is something else — after a rollback, say.
  // Then it really does rebuild, and the old wording is the honest one.
  useForkMaintenance.setState({ state: { ...idle, runningIsHead: false } });
  await render();
  button("Rebuild from upstream");

  // An older runner cannot answer, so claim nothing.
  const older: ForkUpdateState = { ...idle };
  delete (older as { runningIsHead?: boolean }).runningIsHead;
  useForkMaintenance.setState({ state: older });
  await render();
  button("Rebuild from upstream");

  // Uncommitted files make the run throw before it does anything, so offering
  // it offers a failure.
  useForkMaintenance.setState({ state: { ...idle, runningIsHead: true, localClean: false } });
  await render();
  expect(button("Check for an update").disabled).toBe(true);
  expect(container.textContent).toContain("uncommitted changes");
});
