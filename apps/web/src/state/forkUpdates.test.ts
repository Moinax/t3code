import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { fetchForkUpdates, GitHubRateLimitError } from "../lib/forkUpdates";
import { useForkUpdatesStore } from "./forkUpdates";

vi.mock("../lib/forkUpdates", async (original) => ({
  ...(await original<typeof import("../lib/forkUpdates")>()),
  fetchForkUpdates: vi.fn(),
}));
const nightly = {
  tag: "v0.1.1-nightly.20261020.3401",
  commit: "41b513d99aac6ba4d4a4000a3a3a1320b0f79dad",
  publishedAt: "2026-10-20T08:56:40Z",
  eligibleAt: Date.parse("2026-10-20T14:56:40Z"),
};
const data = {
  count: 7,
  commits: [],
  checkedAt: 1000,
  nightly,
  compareUrl: `https://github.com/Moinax/t3code/compare/moinax...pingdotgg:${nightly.commit}`,
};
beforeEach(() => {
  vi.useFakeTimers();
  useForkUpdatesStore.setState({
    data: null,
    error: null,
    loading: false,
    nextCheckAt: 0,
    retryAt: 0,
  });
  vi.mocked(fetchForkUpdates).mockReset();
});
afterEach(() => vi.useRealTimers());

it("shares in-flight work and waits 15 minutes between automatic checks", async () => {
  vi.mocked(fetchForkUpdates).mockResolvedValue(data);
  const { refresh } = useForkUpdatesStore.getState();
  await Promise.all([refresh(), refresh()]);
  await refresh();
  expect(fetchForkUpdates).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(15 * 60_000);
  await refresh();
  expect(fetchForkUpdates).toHaveBeenCalledTimes(2);
});

it("keeps the last result on failure and lets the user retry immediately", async () => {
  vi.mocked(fetchForkUpdates)
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ...data, count: 0 });
  const { refresh } = useForkUpdatesStore.getState();
  await refresh();
  await refresh(true);
  expect(useForkUpdatesStore.getState()).toMatchObject({
    data,
    loading: false,
    error: expect.any(String),
  });
  await refresh(true);
  expect(useForkUpdatesStore.getState()).toMatchObject({ data: { count: 0 }, error: null });
});

it("blocks manual retries until GitHub's rate limit expires", async () => {
  const now = Date.UTC(2026, 9, 28, 12);
  vi.setSystemTime(now);
  vi.mocked(fetchForkUpdates)
    .mockRejectedValueOnce(new GitHubRateLimitError(now + 60_000))
    .mockResolvedValue(data);
  const { refresh } = useForkUpdatesStore.getState();
  await refresh();
  await refresh(true);
  expect(fetchForkUpdates).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  await refresh(true);
  expect(fetchForkUpdates).toHaveBeenCalledTimes(2);
});
