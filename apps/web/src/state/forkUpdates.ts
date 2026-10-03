import { useEffect } from "react";
import { create } from "zustand";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { fetchForkUpdates, GitHubRateLimitError, type ForkUpdates } from "../lib/forkUpdates";

const REFRESH_INTERVAL_MS = 15 * 60_000;

interface ForkUpdatesState {
  readonly data: ForkUpdates | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly nextCheckAt: number;
  readonly retryAt: number;
  readonly refresh: (force?: boolean) => Promise<void>;
}

export const useForkUpdatesStore = create<ForkUpdatesState>((set, get) => ({
  data: null,
  loading: false,
  error: null,
  nextCheckAt: 0,
  retryAt: 0,
  refresh: async (force = false) => {
    const state = get();
    const now = Date.now();
    if (state.loading || now < state.retryAt || (!force && now < state.nextCheckAt)) return;
    set({ loading: true, nextCheckAt: now + REFRESH_INTERVAL_MS });
    try {
      const data = await fetchForkUpdates();
      set({ data, error: null, retryAt: 0 });
    } catch (error) {
      set({
        error:
          error instanceof GitHubRateLimitError
            ? error.message
            : "Could not check GitHub. Check your connection and try refreshing.",
        retryAt: error instanceof GitHubRateLimitError ? error.retryAt : 0,
      });
    } finally {
      set({ loading: false });
    }
  },
}));

/** The sidebar and page share one request and keep the last successful result on failure. */
export function useForkUpdates() {
  const state = useForkUpdatesStore();
  const { refresh } = state;
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useLiveRefresh(
    () => {
      void refresh();
    },
    { key: "fork-updates" },
  );
  return state;
}
