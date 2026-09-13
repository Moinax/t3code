import * as Schema from "effect/Schema";

export const FORK_COMPARE_URL = "https://github.com/Moinax/t3code/compare/moinax...pingdotgg:main";
const API_COMPARE_URL = "https://api.github.com/repos/Moinax/t3code/compare/";
const PAGE_SIZE = 100;

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
  const readPage = async (comparison: string, page: number) => {
    const response = await fetch(
      `${API_COMPARE_URL}${comparison}?per_page=${PAGE_SIZE}&page=${page}`,
      {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        signal,
      },
    );
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
    return decodeComparison(await response.json());
  };

  const first = await readPage("moinax...pingdotgg:main", 1);
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
    commits: commits.toReversed().map(({ sha, commit }) => ({
      sha,
      title: commit.message.split("\n")[0] ?? commit.message,
      message: commit.message,
      author: commit.author?.name ?? "Unknown author",
      date: commit.author?.date ?? null,
    })),
  };
}
