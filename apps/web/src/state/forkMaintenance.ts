import {
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
export const useForkMaintenance = create<ForkMaintenanceStore>((set, get) => ({
  state: null,
  pending: false,
  error: null,
  request: async (action) => {
    const bridge = window.desktopBridge?.forkUpdate;
    if (!bridge || get().pending) return;
    set({ pending: true });
    try {
      const previous = get().state;
      const state = await bridge(action);
      set({ state, error: null });
      if (state.stage === "ready" && previous?.stage !== "ready") {
        void useForkUpdatesStore.getState().refresh(true);
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Could not contact the fork updater.",
      });
    } finally {
      set({ pending: false });
    }
  },
}));

/** Mounted once in the sidebar. Status survives navigation and reconnects to the local job. */
export function useForkMaintenanceMonitor() {
  useEffect(() => {
    if (!window.desktopBridge?.forkUpdate) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const store = useForkMaintenance.getState();
      await store.request("status");
      if (disposed) return;
      const state = useForkMaintenance.getState().state;
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
