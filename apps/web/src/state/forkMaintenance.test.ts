import type { ForkUpdateState } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useForkMaintenance } from "./forkMaintenance";
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
