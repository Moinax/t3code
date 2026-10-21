import { ExternalLinkIcon } from "lucide-react";
import { groupForkChanges } from "../lib/forkChanges";
import { commitUrl, FORK_REPO, UPSTREAM_REPO, upstreamPullUrl } from "../lib/forkUpdates";
import { cn } from "../lib/utils";

/**
 * What the installed update brings in, grouped by what the subject line already
 * says it is.
 *
 * Which repository the shas belong to is the build's own: a hand-built or
 * in-app local build brings fork commits, and linking those to upstream is a
 * link to a 404. A pull number in a subject is upstream's too — our commits
 * reach the branch without one — so it only shortens an upstream link.
 *
 * Kept on screen after the run that resolved it — the runner carries it on the
 * installed build's prepared state — because "what changed?" is asked when
 * deciding whether to restart, which is long after the log that scrolled past
 * has stopped being read. The list is capped by the runner, so the count beside
 * the heading is the honest total and the groups may hold fewer.
 */
export function ForkUpdateChanges({
  changes,
  total,
  defaultOpen = false,
  local = false,
}: {
  changes: readonly string[];
  total: number;
  defaultOpen?: boolean;
  local?: boolean;
}) {
  const groups = groupForkChanges(changes);
  if (groups.length === 0) return null;
  return (
    <details open={defaultOpen} className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">
        What this {local ? "build" : "update"} brings{" "}
        <span className="tabular-nums">
          {total > changes.length
            ? `(${changes.length} of ${total})`
            : `(${total || changes.length})`}
        </span>
      </summary>
      <div className="max-h-96 overflow-y-auto border-t border-border">
        {groups.map((group) => (
          <details
            key={group.key}
            open={group.open}
            className="border-b border-border last:border-b-0"
          >
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide">
              <span
                aria-hidden="true"
                className={cn("size-1.5 shrink-0 rounded-full", group.dot)}
              />
              {group.label}
              <span className="font-medium normal-case tracking-normal text-muted-foreground tabular-nums">
                {group.changes.length}
              </span>
            </summary>
            <ul className="space-y-1 px-3 pb-3">
              {group.changes.map((change) => (
                <li key={change.sha} className="flex items-baseline gap-2 text-sm">
                  {change.scope && (
                    <span className="shrink-0 rounded border border-border px-1 font-mono text-3xs leading-4 text-muted-foreground">
                      {change.scope}
                    </span>
                  )}
                  <span className="min-w-0">
                    {change.title}{" "}
                    <a
                      href={
                        change.pull && !local
                          ? upstreamPullUrl(change.pull)
                          : commitUrl(local ? FORK_REPO : UPSTREAM_REPO, change.sha)
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap font-mono text-xs text-muted-foreground hover:text-foreground focus-visible:outline-ring"
                    >
                      {change.pull && !local ? `#${change.pull}` : change.sha.slice(0, 7)}
                      <ExternalLinkIcon aria-hidden="true" className="ml-0.5 inline size-3" />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </details>
  );
}
