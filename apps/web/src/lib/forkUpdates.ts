import * as Schema from "effect/Schema";

/** The two repositories every GitHub URL and request in the fork UI is built from. */
export const FORK_REPO = "Moinax/t3code";
export const UPSTREAM_REPO = "pingdotgg/t3code";

const API_COMPARE_URL = `https://api.github.com/repos/${FORK_REPO}/compare/`;
const API_RELEASES_URL = `https://api.github.com/repos/${UPSTREAM_REPO}/releases?per_page=30`;
const PAGE_SIZE = 100;

export function forkCompareUrl(target: string): string {
  return `https://github.com/${FORK_REPO}/compare/moinax...${UPSTREAM_REPO.split("/")[0]}:${target}`;
}
export const commitUrl = (repo: string, sha: string) =>
  `https://github.com/${repo}/commit/${encodeURIComponent(sha)}`;
export const upstreamCommitUrl = (sha: string) => commitUrl(UPSTREAM_REPO, sha);
export const upstreamPullUrl = (pull: number) =>
  `https://github.com/${UPSTREAM_REPO}/pull/${encodeURIComponent(String(pull))}`;

/**
 * When upstream could next publish a scheduled nightly, as one short phrase.
 *
 * Said in one place because two surfaces show it — the sidebar tooltip and the
 * Fork updates page — and two wordings of the same clock can contradict each
 * other on screen at the same moment.
 */
export function nextNightlyPhrase(eligibleAt: number | null | undefined, now = new Date()) {
  const window = nextNightlyWindow(eligibleAt, now.getTime());
  if (window === null) return "upstream has published no nightly to follow";
  const when = new Date(window);
  // Dated unless it falls today: the six-hour gap routinely puts the next slot
  // after midnight, and a bare "before 04:08" read at 22:30 says the opposite
  // of what it means.
  return `no nightly before ${
    when.toDateString() === now.toDateString()
      ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : when.toLocaleString()
  }`;
}

const GitHubRelease = Schema.Struct({
  tag_name: Schema.String,
  target_commitish: Schema.String,
  published_at: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  assets: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String })),
});
const decodeReleases = Schema.decodeUnknownSync(Schema.Array(GitHubRelease));

export interface ForkNightly {
  readonly tag: string;
  readonly commit: string;
  readonly publishedAt: string | null;
  /**
   * The instant upstream's six-hour gap expires, in epoch ms: no *scheduled*
   * nightly can be published before it. Null when upstream has published none
   * to count from.
   *
   * Stored rather than the window it implies, because this is a fixed point
   * while the window moves: once the gap has passed, the next opportunity is
   * simply the next cron slot, and a value computed at fetch time would be in
   * the past fifteen minutes later.
   */
  readonly eligibleAt: number | null;
}

/** Upstream's cron, in minutes past each UTC hour (`.github/workflows/release.yml`). */
const NIGHTLY_SLOTS = [8, 38];
/** `MINIMUM_RELEASE_GAP_MS` in upstream's `.github/scripts/check-nightly-release.cjs`. */
const NIGHTLY_GAP_MS = 6 * 60 * 60 * 1000;

/**
 * When upstream's six-hour gap expires.
 *
 * Measured from the newest nightly release whether or not it carries a build,
 * because that is the one upstream's own check measures from. Reading it off
 * the newest *built* release instead would skip a withdrawn nightly's clock and
 * promise a moment that has already been spent.
 */
export function nightlyEligibleAt(releases: readonly (typeof GitHubRelease.Type)[]): number | null {
  const published = releases
    .filter((release) => !release.draft && release.published_at && isNightlyTag(release.tag_name))
    .map((release) => Date.parse(release.published_at ?? ""))
    .filter((time) => Number.isFinite(time));
  return published.length === 0 ? null : Math.max(...published) + NIGHTLY_GAP_MS;
}

/**
 * The earliest moment a *scheduled* nightly can be published: the next cron
 * slot at or after the six-hour gap expires — or, once it has, the next slot
 * from now.
 *
 * There is always one, which is the point. Upstream's cron fires twice an hour
 * and nothing is published between those slots, so "a nightly can land at any
 * time" was never true: at 19:20 the answer is 19:38.
 *
 * Only a floor, and deliberately so. The gap is checked for scheduled runs
 * alone, so a maintainer dispatching a hotfix by hand lands before it — a
 * quarter of them do. That only ever makes an update arrive earlier than
 * announced, which costs nothing when it installs itself; promising a time it
 * could miss in the other direction would.
 */
export function nextNightlyWindow(
  eligibleAt: number | null | undefined,
  now: number = Date.now(),
): number | null {
  if (eligibleAt === null || eligibleAt === undefined) return null;
  const from = Math.max(eligibleAt, now);
  const start = new Date(from);
  for (let hours = 0; hours < 2; hours++)
    for (const minute of NIGHTLY_SLOTS) {
      const candidate = Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth(),
        start.getUTCDate(),
        start.getUTCHours() + hours,
        minute,
      );
      if (candidate >= from) return candidate;
    }
  return null;
}

const isNightlyTag = (tag: string) => tag.includes("-nightly.");

/**
 * The newest nightly upstream built and still stands behind. A tag alone proves
 * nothing: upstream creates tag and release together once the builds pass, so a
 * tag with no release is one whose release was withdrawn — GitHub keeps the tag.
 * The release and an uploaded AppImage asset are what make a commit a candidate.
 * `scripts/fork-update.mjs` selects the same way for the rebase; keep them level.
 */
export function selectNightly(
  releases: readonly (typeof GitHubRelease.Type)[],
): ForkNightly | null {
  const built = releases
    .filter(
      (release) =>
        !release.draft &&
        release.prerelease &&
        isNightlyTag(release.tag_name) &&
        /^[0-9a-f]{40}$/.test(release.target_commitish) &&
        release.assets.some(
          (asset) => asset.state === "uploaded" && asset.name.endsWith(".AppImage"),
        ),
    )
    .toSorted((a, b) => Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? ""));
  const latest = built[0];
  return latest
    ? {
        tag: latest.tag_name,
        commit: latest.target_commitish,
        publishedAt: latest.published_at,
        eligibleAt: nightlyEligibleAt(releases),
      }
    : null;
}

const GitHubCommit = Schema.Struct({
  sha: Schema.String,
  commit: Schema.Struct({
    message: Schema.String,
    author: Schema.NullOr(Schema.Struct({ name: Schema.String, date: Schema.String })),
  }),
});
const GitHubComparison = Schema.Struct({
  total_commits: Schema.Number,
  permalink_url: Schema.String,
  commits: Schema.Array(GitHubCommit),
});

const decodeComparison = Schema.decodeUnknownSync(GitHubComparison);

export interface ForkCommit {
  readonly sha: string;
  readonly title: string;
  readonly message: string;
  readonly author: string;
  readonly date: string | null;
}

export interface ForkUpdates {
  readonly count: number;
  readonly commits: readonly ForkCommit[];
  readonly checkedAt: number;
  readonly nightly: ForkNightly;
  readonly compareUrl: string;
}

export class GitHubRateLimitError extends Error {
  constructor(readonly retryAt: number) {
    super(
      "GitHub's request limit was reached. Try again after " +
        new Date(retryAt).toLocaleTimeString() +
        ".",
    );
  }
}

/** Read a fixed comparison across pages, even if either branch moves during the request. */
export async function fetchForkUpdates(): Promise<ForkUpdates> {
  const signal = AbortSignal.timeout(60_000);
  const read = async (url: string) => {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      signal,
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        throw new GitHubRateLimitError(
          retryAfter > 0 ? Date.now() + retryAfter * 1000 : Math.max(reset, Date.now() + 60_000),
        );
      }
      throw new Error(`GitHub could not check the fork (HTTP ${response.status}).`);
    }
    return response.json();
  };
  const readPage = async (comparison: string, page: number) =>
    decodeComparison(
      await read(`${API_COMPARE_URL}${comparison}?per_page=${PAGE_SIZE}&page=${page}`),
    );

  // Compare against the nightly, not main: commits past it are not in any build
  // upstream has run, and the update never takes them, so listing them here
  // would report work this fork has deliberately not caught up on yet.
  const nightly = selectNightly(decodeReleases(await read(API_RELEASES_URL)));
  if (!nightly) throw new Error("Upstream has published no built nightly release to follow.");
  const first = await readPage(`moinax...pingdotgg:${nightly.commit}`, 1);
  const pinnedComparison = first.permalink_url.match(
    /^https:\/\/github\.com\/Moinax\/t3code\/compare\/(Moinax:[a-f0-9]+\.\.\.pingdotgg:[a-f0-9]+)$/i,
  )?.[1];
  if (!pinnedComparison || !Number.isSafeInteger(first.total_commits) || first.total_commits < 0) {
    throw new Error("GitHub returned an invalid fork comparison.");
  }
  const commits = [...first.commits];
  for (let page = 2; commits.length < first.total_commits; page += 1) {
    const next = await readPage(pinnedComparison, page);
    if (next.commits.length === 0 || next.total_commits !== first.total_commits) {
      throw new Error("GitHub returned an incomplete commit list. Try refreshing.");
    }
    commits.push(...next.commits);
  }
  if (
    commits.length !== first.total_commits ||
    new Set(commits.map((c) => c.sha)).size !== commits.length
  ) {
    throw new Error("GitHub returned an inconsistent commit list. Try refreshing.");
  }
  return {
    count: first.total_commits,
    checkedAt: Date.now(),
    nightly,
    compareUrl: forkCompareUrl(nightly.commit),
    commits: commits.toReversed().map(({ sha, commit }) => ({
      sha,
      title: commit.message.split("\n")[0] ?? commit.message,
      message: commit.message,
      author: commit.author?.name ?? "Unknown author",
      date: commit.author?.date ?? null,
    })),
  };
}
