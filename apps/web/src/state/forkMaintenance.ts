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
 * Whether to prepare the newest nightly without being asked.
 *
 * Deliberately not on `error` or `cancelled`: a run that failed would be
 * retried every fifteen seconds, which is a build loop rather than an update.
 * `autoStartedFor` is the second half of that guard — a run that ends `idle`
 * leaves every condition here true, so without it the same nightly would start
 * again on the next poll.
 *
 * `ready` is allowed through: an update waiting for a restart holds back only
 * its own nightly, not the next one. Waiting for the restart instead would make
 * every hour away from the machine an hour of updates not taken, and the build
 * it replaces was never run. What it does hold back is a *local* build, which
 * was asked for by hand and is not ours to discard — until the restart takes
 * it, after which there is nothing left to protect.
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
      // The prepared commit is our rebase, never the nightly's own sha, so the
      // tag it followed is what says whether this nightly is already prepared.
      // An absent tag counts as "already", not "not yet": `autoStartedFor` is in
      // memory and resets with the window, so a runner too old to record the tag
      // would otherwise rebuild the same prepared nightly on every reload.
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
