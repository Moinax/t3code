import {
  getForkUpdatePreparedVersion,
  isForkUpdateRunning,
  type ForkUpdateAction,
  type ForkUpdateState,
} from "@t3tools/contracts";
import { useEffect } from "react";
import { create } from "zustand";
import { useForkUpdatesStore } from "./forkUpdates";

interface ForkMaintenanceStore {
  state: ForkUpdateState | null;
  pending: boolean;
  error: string | null;
  request: (action: ForkUpdateAction) => Promise<void>;
}
export const useForkMaintenance = create<ForkMaintenanceStore>((set, get) => {
  let latestRequest = 0;
  let checking = false;
  return {
    state: null,
    pending: false,
    error: null,
    request: async (action) => {
      const bridge = window.desktopBridge?.forkUpdate;
      const statusOnly = action === "status";
      if (!bridge || get().pending || (statusOnly && checking)) return;
      const requestId = ++latestRequest;
      if (statusOnly) checking = true;
      else set({ pending: true });
      try {
        const previous = get().state;
        const state = await bridge(action);
        // A user action takes priority over an older status request still in flight.
        if (requestId !== latestRequest) return;
        set({ state, error: null });
        if (state.stage === "ready" && state.source !== "local" && previous?.stage !== "ready") {
          void useForkUpdatesStore.getState().refresh(true);
        }
      } catch (error) {
        if (requestId !== latestRequest) return;
        set({
          error: error instanceof Error ? error.message : "Could not contact the fork updater.",
        });
      } finally {
        if (statusOnly) checking = false;
        else set({ pending: false });
      }
    },
  };
});

/**
 * Whether to prepare the newest nightly unasked. Not after `error` or `cancelled` (a retry loop),
 * and `autoStartedFor` stops an `idle` run restarting the same nightly. `ready` passes, since a
 * pending restart holds back only its own nightly, unless it holds a hand-requested local build.
 */
export function shouldPrepareNightly(input: {
  readonly state: ForkUpdateState | null;
  readonly pendingCommits: number;
  readonly nightlyCommit: string | undefined;
  readonly nightlyTag: string | undefined;
  readonly autoStartedFor: string | null;
}): boolean {
  const { state, pendingCommits, nightlyCommit, nightlyTag } = input;
  if (!state?.available || !nightlyCommit || pendingCommits <= 0) return false;
  if (isForkUpdateRunning(state.stage)) return false;
  if (state.stage !== "idle" && state.stage !== "ready") return false;
  if (state.stage === "ready") {
    const prepared = getForkUpdatePreparedVersion(state);
    // A prepared build that is already running protects nothing — the record
    // outlives the restart, and reading it as still pending would leave a hand
    // install holding back every nightly for good.
    if (prepared && prepared !== state.runningVersion) {
      if (state.preparedSource === "local") return false;
      // The prepared commit is our rebase, so the tag it followed says whether this
      // nightly is prepared. A missing tag counts as prepared: `autoStartedFor` resets
      // with the window, so an older runner would rebuild on every reload.
      if (!state.targetTag || state.targetTag === nightlyTag) return false;
    }
  }
  // `localClean` is absent on an older runner; treat the unknown as dirty
  // rather than start a run that would fail on the checkout's own edits.
  if (state.localClean !== true) return false;
  return input.autoStartedFor !== nightlyCommit;
}

/** Mounted once in the sidebar. Status survives navigation and reconnects to the local job. */
export function useForkMaintenanceMonitor() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the desktop fork-update job while the sidebar is mounted
  useEffect(() => {
    if (!window.desktopBridge?.forkUpdate) return;
    let disposed = false;
    let autoStartedFor: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const store = useForkMaintenance.getState();
      await store.request("status");
      if (disposed) return;
      const state = useForkMaintenance.getState().state;
      const updates = useForkUpdatesStore.getState();
      const nightlyCommit = updates.data?.nightly.commit;
      if (
        shouldPrepareNightly({
          state,
          pendingCommits: updates.data?.count ?? 0,
          nightlyCommit,
          nightlyTag: updates.data?.nightly.tag,
          autoStartedFor,
        })
      ) {
        autoStartedFor = nightlyCommit ?? null;
        await store.request("start");
        if (disposed) return;
      }
      timer = setTimeout(
        () => void poll(),
        state && isForkUpdateRunning(state.stage) ? 2000 : 15000,
      );
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
}
