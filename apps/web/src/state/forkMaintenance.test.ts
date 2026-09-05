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
