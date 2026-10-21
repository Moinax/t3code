import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  fetchForkUpdates,
  nextNightlyPhrase,
  nextNightlyWindow,
  nightlyEligibleAt,
} from "./forkUpdates";

/** Every check resolves the nightly to compare against before it compares. */
const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: "v0.1.1-nightly.20261020.3411",
  target_commitish: "4".repeat(40),
  published_at: "2026-10-20T10:44:44Z",
  draft: false,
  prerelease: true,
  assets: [{ name: "T3 Code.AppImage", state: "uploaded" }],
  ...overrides,
});
const releases = (...overrides: Record<string, unknown>[]) =>
  Response.json(overrides.length === 0 ? [release()] : overrides.map(release));

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
      .mockResolvedValueOnce(releases())
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
    expect(fetch.mock.calls[0]?.[0]).toContain("/releases?");
    expect(fetch.mock.calls[2]?.[0]).toContain(
      "Moinax:abc1234...pingdotgg:def5678?per_page=100&page=2",
    );
    expect(fetch.mock.calls[3]?.[0]).toContain("page=3");
  });

  it("reports an up-to-date fork with one request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(releases())
      .mockResolvedValue(Response.json(comparison(0, [])));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchForkUpdates()).toMatchObject({
      count: 0,
      commits: [],
      nightly: { tag: "v0.1.1-nightly.20261020.3411" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not present an incomplete list as a successful check", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(releases())
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
        .mockResolvedValueOnce(releases())
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

  it("refuses to check against a nightly whose build is not attached", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(releases({ assets: [{ name: "notes.txt", state: "uploaded" }] })),
    );
    await expect(fetchForkUpdates()).rejects.toThrow("no built nightly");
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

describe("nextNightlyWindow", () => {
  const at = (iso: string) => Date.parse(iso);
  const published = (iso: string, overrides: Record<string, unknown> = {}) => ({
    tag_name: "v0.1.1-nightly.20261020.3411",
    target_commitish: "4".repeat(40),
    published_at: iso,
    draft: false,
    prerelease: true,
    assets: [],
    ...overrides,
  });
  const after = (iso: string) => nightlyEligibleAt([published(iso)]);

  it("is the first cron slot at or after the six-hour gap expires", () => {
    // Published 10:44:44Z, so eligible 16:44:44Z, and :08 is the slot after it.
    expect(nextNightlyWindow(after("2026-10-20T10:44:44Z"), at("2026-10-20T15:36:00Z"))).toBe(
      at("2026-10-20T17:08:00Z"),
    );
    // A gap ending between the two slots of an hour takes the later one.
    expect(nextNightlyWindow(after("2026-10-20T10:20:00Z"), at("2026-10-20T12:00:00Z"))).toBe(
      at("2026-10-20T16:38:00Z"),
    );
    // And one ending in the last minutes of an hour rolls into the next.
    expect(nextNightlyWindow(after("2026-10-20T10:50:00Z"), at("2026-10-20T12:00:00Z"))).toBe(
      at("2026-10-20T17:08:00Z"),
    );
  });

  it("keeps naming a slot once the gap has passed, because nothing lands between them", () => {
    // The gap expired at 16:44, so the answer is no longer about the gap — but
    // upstream's cron still only fires twice an hour, and "any time" would be
    // wrong at 17:20, where the real answer is 17:38.
    const eligible = after("2026-10-20T10:44:44Z");
    expect(nextNightlyWindow(eligible, at("2026-10-20T17:20:00Z"))).toBe(
      at("2026-10-20T17:38:00Z"),
    );
    expect(nextNightlyWindow(eligible, at("2026-10-20T17:50:00Z"))).toBe(
      at("2026-10-20T18:08:00Z"),
    );
    // Asked exactly on a slot, that slot still counts.
    expect(nextNightlyWindow(eligible, at("2026-10-20T18:08:00Z"))).toBe(
      at("2026-10-20T18:08:00Z"),
    );
  });

  it("has nothing to say only when upstream has published no nightly", () => {
    expect(nightlyEligibleAt([])).toBe(null);
    expect(nextNightlyWindow(null, at("2026-10-20T20:00:00Z"))).toBe(null);
    expect(nextNightlyPhrase(null)).toContain("no nightly to follow");
  });

  it("clocks the gap from a withdrawn nightly too, as upstream's own check does", () => {
    // The withdrawn release carries no build, so `selectNightly` skips it — but
    // upstream counts the six hours from it all the same. Reading the clock off
    // the newest *built* one would name a slot five hours too early.
    const built = published("2026-10-20T01:46:21Z");
    const withdrawn = published("2026-10-20T07:48:00Z", { assets: [] });
    const now = at("2026-10-20T09:00:00Z");
    expect(nextNightlyWindow(nightlyEligibleAt([built, withdrawn]), now)).toBe(
      at("2026-10-20T14:08:00Z"),
    );
    expect(nextNightlyWindow(nightlyEligibleAt([built]), now)).toBe(at("2026-10-20T09:08:00Z"));
  });

  it("ignores drafts and anything that is not a nightly", () => {
    const now = at("2026-10-20T12:00:00Z");
    const releases = [
      published("2026-10-20T11:00:00Z", { draft: true }),
      published("2026-10-20T11:30:00Z", { tag_name: "v0.1.1-preview.20261020.3410" }),
      published("2026-10-20T09:00:00Z"),
    ];
    expect(nextNightlyWindow(nightlyEligibleAt(releases), now)).toBe(at("2026-10-20T15:08:00Z"));
  });

  it("dates the moment when it does not fall today", () => {
    // A bare "before 04:08" read at 22:30 says the opposite of what it means.
    const tonight = new Date("2026-10-20T22:10:00Z");
    const phrase = nextNightlyPhrase(after("2026-10-20T22:10:00Z"), tonight);
    expect(phrase).toContain("no nightly before");
    expect(phrase.length).toBeGreaterThan("no nightly before 04:08".length);
  });
});
