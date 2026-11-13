import { getForkUpdatePreparedVersion, isForkUpdateRunning } from "@t3tools/contracts";
import type { ForkUpdateState } from "@t3tools/contracts";
import { msg } from "gt-react";
import { m, type MessageResolver } from "../i18n/messages";
import { nextNightlyPhrase } from "./forkUpdates";

export interface ForkUpdateSummary {
  readonly label: string;
  /** What the badge reads, or null when there is nothing worth interrupting for. */
  readonly badge: string | null;
  readonly tone: "success" | "warning";
  readonly running: boolean;
}

/**
 * What the sidebar's fork item says and whether it wears a badge, decided once so label and
 * badge cannot disagree. The usual quiet state shows nothing: an always-on badge goes unread.
 */
export function summarizeForkUpdates(
  input: {
    readonly job: ForkUpdateState | null;
    readonly updates: {
      count: number;
      nightly: { tag: string; eligibleAt: number | null };
    } | null;
    readonly checkError: string | null;
    readonly loading: boolean;
  },
  resolve: MessageResolver = m,
): ForkUpdateSummary {
  const { job, updates, checkError, loading } = input;
  const running = job ? isForkUpdateRunning(job.stage) : false;
  const preparedVersion = job ? getForkUpdatePreparedVersion(job) : null;
  const ready = !running && !!preparedVersion && preparedVersion !== job?.runningVersion;
  const failed = job?.stage === "error";

  if (running)
    return {
      label: resolve(msg("Fork update: {message}", { message: job?.message ?? "" })),
      badge: null,
      tone: "success",
      running: true,
    };
  if (ready)
    return {
      label:
        job?.preparedSource === "local"
          ? resolve(msg("Local build ready: restart from Fork updates"))
          : resolve(msg("Fork update ready: restart from Fork updates")),
      badge: "✓",
      tone: "success",
      running: false,
    };
  if (failed)
    return {
      label: resolve(msg("Fork update needs attention")),
      badge: "!",
      tone: "warning",
      running: false,
    };
  if (checkError)
    return {
      label: updates
        ? resolve(
            msg("Fork updates: {error} Last count: {count}.", {
              error: checkError,
              count: updates.count,
            }),
          )
        : resolve(msg("Fork updates: {error}", { error: checkError })),
      badge: "!",
      tone: "warning",
      running: false,
    };
  if (!updates)
    return {
      label: loading ? resolve(msg("Fork updates: checking GitHub")) : resolve(msg("Fork updates")),
      badge: null,
      tone: "success",
      running: false,
    };
  if (updates.count > 0)
    return {
      // Commits that stay missing mean the automatic path is held by the checkout's
      // own edits. An unknown `localClean` counts as held, as in `shouldPrepareNightly`,
      // rather than reporting "up to date" over a fork nothing will update.
      label:
        job?.localClean === true
          ? resolve(
              msg(
                "{count, plural, one {Fork updates: {count} upstream commit missing} other {Fork updates: {count} upstream commits missing}}",
                { count: updates.count },
              ),
            )
          : resolve(
              msg(
                "{count, plural, one {Fork updates: {count} upstream commit waiting (the checkout has uncommitted changes)} other {Fork updates: {count} upstream commits waiting (the checkout has uncommitted changes)}}",
                { count: updates.count },
              ),
            ),
      badge: updates.count > 999 ? "999+" : String(updates.count),
      tone: "warning",
      running: false,
    };
  return {
    label: resolve(
      msg("Fork is up to date · following {tag} · {next}", {
        tag: updates.nightly.tag,
        next: nextNightlyPhrase(updates.nightly.eligibleAt),
      }),
    ),
    badge: null,
    tone: "success",
    running: false,
  };
}
