import type { ForkUpdateState } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useForkMaintenance } from "../state/forkMaintenance";
import { ForkMaintenancePanel } from "./ForkMaintenancePanel";
import { Button } from "./ui/button";

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
let renderer: ReactTestRenderer;

function button(label: string) {
  const result = renderer.root.findAllByType(Button).find((item) => item.props.children === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function localButtons() {
  const heading = renderer.root
    .findAllByType("h3")
    .find((node) => node.children.includes("Local changes"));
  return heading!.parent!.parent!.findAllByType(Button);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { desktopBridge: { forkUpdate: bridge } });
  bridge.mockReset();
  useForkMaintenance.setState({ state: prepared, pending: false, error: null });
});
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it("updates the fork and offers restart without another local installation", async () => {
  useForkMaintenance.setState({ state: { ...prepared, runningVersion: prepared.version! } });
  await act(() => {
    renderer = create(<ForkMaintenancePanel />);
  });
  bridge.mockResolvedValue({ ...prepared, stage: "fetching" });
  await act(() => button("Update fork").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("start");
  expect(button("Cancel update").props.disabled).toBe(false);
  const next = {
    ...prepared,
    preparedVersion: "next",
    version: "next",
    localBuildStatus: "up-to-date",
  };
  bridge.mockResolvedValue(next);
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Up to date").props.disabled).toBe(true);
  bridge.mockResolvedValue({ ...next, runningVersion: "next" });
  await act(() => button("Restart").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("restart");
  expect(button("Update fork").props.disabled).toBe(false);
  expect(button("Up to date").props.disabled).toBe(true);
});

it("builds local changes while upstream is ready and offers the resulting local version to restart", async () => {
  await act(() => {
    renderer = create(<ForkMaintenancePanel />);
  });
  expect(button("Install local changes").props.disabled).toBe(false);
  expect(button("Restart").props.disabled).toBe(false);
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    stage: "snapshotting",
    runId: "local-run",
  });
  await act(() => button("Install local changes").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("start-local");
  expect(renderer.root.findByType("h2").children).toEqual(["Installing local changes"]);
  expect(button("Cancel installation").props.disabled).toBe(false);
  expect(button("Restart").props.disabled).toBe(true);

  const localVersion = "1.0.0-moinax.local.123456789";
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    preparedSource: "local",
    version: localVersion,
    preparedVersion: localVersion,
  });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(renderer.root.findByType("h2").children).toEqual(["Ready to restart"]);
  expect(useForkMaintenance.getState().state?.preparedVersion).toBe(localVersion);
  await act(() => button("Restart").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("restart");
});

it("keeps the previous restart available after cancelling a local build", async () => {
  useForkMaintenance.setState({ state: { ...prepared, source: "local", stage: "building" } });
  await act(() => {
    renderer = create(<ForkMaintenancePanel />);
  });
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    stage: "cancelled",
    message: "Build cancelled.",
  });
  await act(() => button("Cancel installation").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("cancel");
  expect(button("Retry installation").props.disabled).toBe(false);
  expect(button("Restart").props.disabled).toBe(false);
  expect(useForkMaintenance.getState().state?.preparedVersion).toBe(prepared.version);
  await act(() => button("Restart").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("restart");
});

it("disables a matching local build, enables it after edits, and disables it again after reverting", async () => {
  useForkMaintenance.setState({
    state: { ...prepared, source: "local", localBuildStatus: "up-to-date" },
  });
  await act(() => {
    renderer = create(<ForkMaintenancePanel />);
  });
  expect(button("Up to date").props.disabled).toBe(true);
  expect(button("Restart").props.disabled).toBe(false);
  bridge.mockResolvedValue({ ...prepared, source: "local", localBuildStatus: "changed" });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Install local changes").props.disabled).toBe(false);
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    localBuildStatus: "up-to-date",
    runningVersion: prepared.version,
  });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Up to date").props.disabled).toBe(true);
  expect(
    renderer.root.findAllByType(Button).some((item) => item.props.children === "Restart"),
  ).toBe(false);
});

it("uses one local action from installation through restart to up to date", async () => {
  const initial: ForkUpdateState = {
    ...prepared,
    source: "local",
    preparedSource: "local",
    runningVersion: prepared.version!,
    localBuildStatus: "changed",
  };
  useForkMaintenance.setState({ state: initial });
  await act(() => {
    renderer = create(<ForkMaintenancePanel />);
  });
  expect(localButtons()).toHaveLength(1);
  bridge.mockResolvedValue({ ...initial, stage: "building" });
  await act(() => button("Install local changes").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("start-local");
  expect(button("Cancel installation").props.disabled).toBe(false);
  expect(localButtons()).toHaveLength(1);
  bridge.mockResolvedValue({ ...initial, stage: "installing" });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Installing…").props.disabled).toBe(true);
  const next = {
    ...initial,
    version: "new-local-build",
    preparedVersion: "new-local-build",
    localBuildStatus: "up-to-date",
  };
  bridge.mockResolvedValue(next);
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Restart").props.disabled).toBe(false);
  expect(localButtons()).toHaveLength(1);
  bridge.mockResolvedValue({ ...next, runningVersion: "new-local-build" });
  await act(() => button("Restart").props.onClick());
  expect(bridge).toHaveBeenLastCalledWith("restart");
  expect(button("Up to date").props.disabled).toBe(true);
  expect(localButtons()).toHaveLength(1);
});

it("keeps restart as the local action when more files change after preparation", async () => {
  useForkMaintenance.setState({
    state: { ...prepared, source: "local", preparedSource: "local", localBuildStatus: "changed" },
  });
  await act(() => {
    renderer = create(<ForkMaintenancePanel />);
  });
  expect(localButtons()).toHaveLength(1);
  expect(button("Restart").props.disabled).toBe(false);
  bridge.mockResolvedValue({
    ...prepared,
    source: "local",
    preparedSource: "local",
    stage: "cancelled",
    localBuildStatus: "changed",
  });
  await act(() => useForkMaintenance.getState().request("status"));
  expect(button("Restart").props.disabled).toBe(false);
});
