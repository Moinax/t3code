import type { ForkUpdateState } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { shouldPrepareNightly, useForkMaintenance } from "./forkMaintenance";
import { useForkUpdatesStore } from "./forkUpdates";

const state: ForkUpdateState = {
  available: true,
  stage: "building",
  message: "Building",
  updatedAt: 1,
  commit: null,
  version: null,
  runningVersion: "1.0.0-moinax.abc123",
  runId: "run",
  workDir: "/tmp/candidate",
  attempt: 0,
  log: "build output",
};
const bridge = vi.fn();
beforeEach(() => {
  vi.stubGlobal("window", { desktopBridge: { forkUpdate: bridge } });
  bridge.mockReset();
  useForkMaintenance.setState({ state: null, pending: false, error: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("serializes requests so repeated clicks cannot launch another job", async () => {
  let finish!: (value: ForkUpdateState) => void;
  bridge.mockImplementation(
    () =>
      new Promise<ForkUpdateState>((resolve) => {
        finish = resolve;
      }),
  );
  const first = useForkMaintenance.getState().request("start");
  await useForkMaintenance.getState().request("start");
  expect(bridge).toHaveBeenCalledTimes(1);
  finish(state);
  await first;
  expect(useForkMaintenance.getState()).toMatchObject({ state, pending: false });
});

it("keeps the last job on connection failure and reconnects to its persisted result", async () => {
  bridge
    .mockResolvedValueOnce(state)
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValueOnce({ ...state, stage: "error", message: "Build failed" });
  const { request } = useForkMaintenance.getState();
  await request("status");
  await request("status");
  expect(useForkMaintenance.getState()).toMatchObject({
    state,
    error: "Disconnected",
    pending: false,
  });
  await request("status");
  expect(useForkMaintenance.getState()).toMatchObject({ state: { stage: "error" }, error: null });
});

it("refreshes the commit count once when a prepared update becomes available", async () => {
  const refresh = vi.spyOn(useForkUpdatesStore.getState(), "refresh").mockResolvedValue();
  bridge.mockResolvedValue({ ...state, stage: "ready", version: "1.0.0-moinax.def456" });
  await useForkMaintenance.getState().request("status");
  await useForkMaintenance.getState().request("status");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(useForkMaintenance.getState().state?.version).not.toBe(state.runningVersion);
});

it("replaces an upstream preparation with a local build without refreshing GitHub", async () => {
  const refresh = vi.spyOn(useForkUpdatesStore.getState(), "refresh").mockResolvedValue();
  useForkMaintenance.setState({
    state: { ...state, stage: "ready", version: "1.0.0-moinax.def456" },
  });
  bridge.mockResolvedValue({ ...state, source: "local", stage: "snapshotting" });
  await useForkMaintenance.getState().request("start-local");
  expect(bridge).toHaveBeenCalledWith("start-local");
  bridge.mockResolvedValue({
    ...state,
    source: "local",
    stage: "ready",
    version: "1.0.0-moinax.local.123456789",
  });
  await useForkMaintenance.getState().request("status");
  expect(refresh).not.toHaveBeenCalled();
  expect(useForkMaintenance.getState().state?.source).toBe("local");
});

it("refreshes status silently and coalesces overlapping status requests", async () => {
  let finish!: (value: ForkUpdateState) => void;
  bridge.mockImplementation(
    () =>
      new Promise<ForkUpdateState>((resolve) => {
        finish = resolve;
      }),
  );
  const first = useForkMaintenance.getState().request("status");
  expect(useForkMaintenance.getState().pending).toBe(false);
  await useForkMaintenance.getState().request("status");
  expect(bridge).toHaveBeenCalledTimes(1);
  finish(state);
  await first;
  expect(useForkMaintenance.getState()).toMatchObject({ state, pending: false });
});

it("accepts a click during polling and keeps the action pending when the old poll finishes", async () => {
  let finishPoll!: (value: ForkUpdateState) => void;
  let finishAction!: (value: ForkUpdateState) => void;
  bridge
    .mockImplementationOnce(
      () =>
        new Promise<ForkUpdateState>((resolve) => {
          finishPoll = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<ForkUpdateState>((resolve) => {
          finishAction = resolve;
        }),
    );
  const poll = useForkMaintenance.getState().request("status");
  const action = useForkMaintenance.getState().request("start-local");
  expect(bridge).toHaveBeenLastCalledWith("start-local");
  expect(useForkMaintenance.getState().pending).toBe(true);
  finishPoll({ ...state, stage: "idle" });
  await poll;
  expect(useForkMaintenance.getState()).toMatchObject({ state: null, pending: true });
  finishAction(state);
  await action;
  expect(useForkMaintenance.getState()).toMatchObject({ state, pending: false });
});

it.each([false, true])(
  "ignores a stale poll after a user action, including failures: %s",
  async (fail) => {
    let resolvePoll!: (value: ForkUpdateState) => void;
    let rejectPoll!: (error: Error) => void;
    bridge
      .mockImplementationOnce(
        () =>
          new Promise<ForkUpdateState>((resolve, reject) => {
            resolvePoll = resolve;
            rejectPoll = reject;
          }),
      )
      .mockResolvedValueOnce(state);
    const poll = useForkMaintenance.getState().request("status");
    await useForkMaintenance.getState().request("start-local");
    if (fail) rejectPoll(new Error("Old request failed"));
    else resolvePoll({ ...state, stage: "idle" });
    await poll;
    expect(useForkMaintenance.getState()).toMatchObject({ state, pending: false, error: null });
  },
);

const idle: ForkUpdateState = {
  ...state,
  stage: "idle",
  message: "Ready to check for an update.",
  runId: null,
  log: "",
  localClean: true,
};
const nightlyCommit = "41b513d99aac6ba4d4a4000a3a3a1320b0f79dad";
const nightlyTag = "v0.1.1-nightly.20261020.3411";
const prepare = (overrides: Partial<Parameters<typeof shouldPrepareNightly>[0]> = {}) =>
  shouldPrepareNightly({
    state: idle,
    pendingCommits: 7,
    nightlyCommit,
    nightlyTag,
    autoStartedFor: null,
    ...overrides,
  });
const prepared: ForkUpdateState = {
  ...idle,
  stage: "ready",
  preparedVersion: "1.0.0-moinax.def456",
  targetTag: "v0.1.1-nightly.20261020.3401",
};

it("prepares the newest nightly on its own when nothing is in the way", () => {
  expect(prepare()).toBe(true);
});

it("waits when the checkout, the runner or upstream is not ready for it", () => {
  expect(prepare({ pendingCommits: 0 })).toBe(false);
  expect(prepare({ nightlyCommit: undefined })).toBe(false);
  expect(prepare({ state: null })).toBe(false);
  expect(prepare({ state: { ...idle, available: false } })).toBe(false);
  expect(prepare({ state: { ...idle, localClean: false } })).toBe(false);
  // An older runner omits the field entirely; absent must not read as clean.
  const older: ForkUpdateState = { ...idle };
  delete (older as { localClean?: boolean }).localClean;
  expect(prepare({ state: older })).toBe(false);
});

it("never restarts a run or retries a failure", () => {
  for (const stage of ["starting", "rebasing", "building", "publishing"] as const)
    expect(prepare({ state: { ...idle, stage } })).toBe(false);
  // The build loop these two guards exist to prevent.
  for (const stage of ["error", "cancelled"] as const)
    expect(prepare({ state: { ...idle, stage } })).toBe(false);
  expect(prepare({ autoStartedFor: nightlyCommit })).toBe(false);
  expect(prepare({ autoStartedFor: "0000000000000000000000000000000000000000" })).toBe(true);
});

it("takes the next nightly over one still waiting to be restarted onto", () => {
  // Hours can pass before a restart, and every one of them would otherwise be
  // an hour of nightlies not taken. The build being replaced never ran.
  expect(prepare({ state: prepared })).toBe(true);
  // Except its own: that one is already built and installed.
  expect(prepare({ state: { ...prepared, targetTag: nightlyTag } })).toBe(false);
  // A local build was asked for by hand, so it is not ours to discard.
  expect(prepare({ state: { ...prepared, preparedSource: "local" } })).toBe(false);
  // And a runner too old to record the tag must not read as "a different
  // nightly": `autoStartedFor` resets with the window, so that would rebuild
  // the prepared nightly on every reload.
  const untagged: ForkUpdateState = { ...prepared };
  delete (untagged as { targetTag?: string | null }).targetTag;
  expect(prepare({ state: untagged })).toBe(false);
  expect(prepare({ state: { ...prepared, targetTag: null } })).toBe(false);
});

it("stops holding back nightlies once the restart has taken the prepared build", () => {
  // The record stays on disk after the restart, so reading it as still pending
  // would make one hand-installed build block upstream for good.
  const running = { ...prepared, preparedVersion: prepared.runningVersion };
  expect(prepare({ state: { ...running, preparedSource: "local" } })).toBe(true);
  expect(prepare({ state: { ...running, targetTag: nightlyTag } })).toBe(true);
});
