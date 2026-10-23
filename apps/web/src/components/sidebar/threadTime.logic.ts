import {
  resolveSettledThreadTimestamp,
  type SettledThreadTimestampInput,
} from "@t3tools/client-runtime/state/thread-sort";

/** What a thread's row shows in its time slot while it is still on an active shelf. */
export function threadTimeTimestamp(
  thread: Pick<SettledThreadTimestampInput, "latestUserMessageAt" | "updatedAt">,
): string {
  return thread.latestUserMessageAt ?? thread.updatedAt;
}

/**
 * A folded group's time: its most recent member's, each member read the way its own row reads
 * it — settled members by when they were put away, the rest by their last message. Null only
 * when no member can answer, which leaves the slot empty rather than dating the group to 1970.
 */
export function groupTimestamp(
  members: readonly {
    readonly isSettled: boolean;
    readonly thread: SettledThreadTimestampInput;
  }[],
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const member of members) {
    const stamp = member.isSettled
      ? resolveSettledThreadTimestamp(member.thread)
      : threadTimeTimestamp(member.thread);
    if (stamp === null) continue;
    // Members can come from different machines, so two stamps are not
    // guaranteed to share an offset: compare the instants, not the text.
    const ms = Date.parse(stamp);
    if (Number.isNaN(ms) || ms <= latestMs) continue;
    latest = stamp;
    latestMs = ms;
  }
  return latest;
}
