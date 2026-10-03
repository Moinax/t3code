import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { fetchForkUpdates } from "./forkUpdates";

const commit = (index: number) => ({
  sha: index.toString(16).padStart(40, "0"),
  commit: {
    message: `Change ${index}\n\nDetails`,
    author: { name: "Ada", date: "2026-09-05T10:00:00Z" },
  },
});
const comparison = (count: number, commits: unknown[]) => ({
  total_commits: count,
  permalink_url: "https://github.com/Moinax/t3code/compare/Moinax:abc1234...pingdotgg:def5678",
  commits,
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchForkUpdates", () => {
  it("loads more than 250 missing commits using pinned revisions and shows newest first", async () => {
    const commits = Array.from({ length: 264 }, (_, i) => commit(i));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(comparison(264, commits.slice(0, 100))))
      .mockResolvedValueOnce(Response.json(comparison(264, commits.slice(100, 200))))
      .mockResolvedValueOnce(Response.json(comparison(264, commits.slice(200))));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchForkUpdates();
    expect(result.count).toBe(264);
    expect(result.commits).toHaveLength(264);
    expect(result.commits[0]).toMatchObject({
      sha: commit(263).sha,
      title: "Change 263",
      author: "Ada",
    });
    expect(result.commits[263]?.sha).toBe(commit(0).sha);
    expect(fetch.mock.calls[1]?.[0]).toContain(
      "Moinax:abc1234...pingdotgg:def5678?per_page=100&page=2",
    );
    expect(fetch.mock.calls[2]?.[0]).toContain("page=3");
  });

  it("reports an up-to-date fork with one request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(comparison(0, [])));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchForkUpdates()).toMatchObject({ count: 0, commits: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not present an incomplete list as a successful check", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            comparison(
              101,
              Array.from({ length: 100 }, (_, i) => commit(i)),
            ),
          ),
        )
        .mockResolvedValueOnce(Response.json(comparison(101, []))),
    );
    await expect(fetchForkUpdates()).rejects.toThrow("incomplete");
  });

  it("handles commits with no author identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            comparison(1, [{ ...commit(1), commit: { message: "A change", author: null } }]),
          ),
        ),
    );
    expect((await fetchForkUpdates()).commits[0]).toMatchObject({
      author: "Unknown author",
      date: null,
    });
  });

  it("honors GitHub rate-limit reset times", async () => {
    const reset = Math.ceil(Date.now() / 1000) + 3600;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 403,
          headers: { "x-ratelimit-reset": String(reset) },
        }),
      ),
    );
    await expect(fetchForkUpdates()).rejects.toMatchObject({ retryAt: reset * 1000 });
  });

  it("reports an HTTP failure instead of a zero count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    await expect(fetchForkUpdates()).rejects.toThrow("HTTP 502");
  });
});
