import { getForkUpdatePreparedVersion, isForkUpdateRunning } from "@t3tools/contracts";
import type { ForkUpdateState } from "@t3tools/contracts";
import { nextNightlyPhrase } from "./forkUpdates";

export interface ForkUpdateSummary {
  readonly label: string;
  /** What the badge reads, or null when there is nothing worth interrupting for. */
  readonly badge: string | null;
  readonly tone: "success" | "warning";
  readonly running: boolean;
}

/**
 * What the sidebar's fork item says and whether it wears a badge.
 *
 * One decision rather than two parallel ternary chains over the same booleans:
 * the label and the badge have to agree, and spelling the states out twice is
 * how they stop agreeing — a warning badge beside a tooltip reading "up to
 * date" is worse than either alone.
 *
 * Nothing to say is said with nothing. A badge that is always there is a badge
 * nobody reads, and the quiet state is the one this sits in nearly always.
 */
export function summarizeForkUpdates(input: {
  readonly job: ForkUpdateState | null;
  readonly updates: {
    count: number;
    nightly: { tag: string; eligibleAt: number | null };
  } | null;
  readonly checkFailed: boolean;
  readonly loading: boolean;
}): ForkUpdateSummary {
  const { job, updates, checkFailed, loading } = input;
  const running = job ? isForkUpdateRunning(job.stage) : false;
  const preparedVersion = job ? getForkUpdatePreparedVersion(job) : null;
  const ready = !running && !!preparedVersion && preparedVersion !== job?.runningVersion;
  const failed = job?.stage === "error";

  if (running)
    return { label: `Fork update: ${job?.message}`, badge: null, tone: "success", running: true };
  if (ready)
    return {
      label: `${job?.preparedSource === "local" ? "Local build" : "Fork update"} ready: restart from Fork updates`,
      badge: "✓",
      tone: "success",
      running: false,
    };
  if (failed)
    return { label: "Fork update needs attention", badge: "!", tone: "warning", running: false };
  if (checkFailed)
    return {
      label: `Fork updates: check failed${updates ? `, last count ${updates.count}` : ""}`,
      badge: "!",
      tone: "warning",
      running: false,
    };
  if (!updates)
    return {
      label: loading ? "Fork updates: checking GitHub" : "Fork updates",
      badge: null,
      tone: "success",
      running: false,
    };
  if (updates.count > 0)
    return {
      // A preparation no longer waits for a restart, so commits that stay
      // missing mean the automatic path is held back rather than slow. The
      // checkout's own edits are what hold it — and an unknown `localClean`
      // counts as held, exactly as `shouldPrepareNightly` treats it, because
      // the alternative is reporting "up to date" over a fork that is not and
      // that nothing is going to update.
      label:
        job?.localClean === true
          ? `Fork updates: ${updates.count} upstream commits missing`
          : `Fork updates: ${updates.count} upstream commits waiting — the checkout has uncommitted changes`,
      badge: updates.count > 999 ? "999+" : String(updates.count),
      tone: "warning",
      running: false,
    };
  return {
    label: `Fork is up to date · following ${updates.nightly.tag} · ${nextNightlyPhrase(updates.nightly.eligibleAt)}`,
    badge: null,
    tone: "success",
    running: false,
  };
}
