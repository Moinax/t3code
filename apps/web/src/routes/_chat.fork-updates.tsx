import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, ExternalLinkIcon, GitCommitHorizontalIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { SidebarInset } from "../components/ui/sidebar";
import { isElectron } from "../env";
import { FORK_COMPARE_URL } from "../lib/forkUpdates";
import { useForkUpdates } from "../state/forkUpdates";

function ForkUpdatesPage() {
  const { data, loading, error, refresh } = useForkUpdates();
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase();
  const commits =
    data?.commits.filter((commit) =>
      `${commit.message} ${commit.author} ${commit.sha}`.toLocaleLowerCase().includes(search),
    ) ?? [];

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        <GitCommitHorizontalIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Fork updates</h1>
      </WorkspacePageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">
                {data
                  ? data.count === 0
                    ? "Your fork is up to date"
                    : `${data.count} upstream commits to catch up on`
                  : "Upstream commits"}
              </h2>
              <p className="text-sm text-muted-foreground">
                pingdotgg/t3code · main → Moinax/t3code · moinax
              </p>
              <p className="text-xs text-muted-foreground">
                Compared with the published fork on GitHub. Local changes are not included.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                render={<a href={FORK_COMPARE_URL} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon /> Compare
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => void refresh(true)}
              >
                <RefreshCwIcon /> {loading ? "Checking…" : "Refresh"}
              </Button>
            </div>
          </div>
          <div className="space-y-2" aria-live="polite">
            <p className="text-xs text-muted-foreground">
              {data ? `Last checked ${new Date(data.checkedAt).toLocaleString()}. ` : ""}
              Checks every 15 minutes while the app is active.
            </p>
            {error && (
              <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
                {error}
                {data ? " Showing the last successful check." : ""}
              </p>
            )}
            {!data && loading && (
              <p className="text-sm text-muted-foreground">Checking upstream commits…</p>
            )}
          </div>
          {data && data.count > 0 && (
            <>
              <Input
                aria-label="Search commits"
                placeholder="Search commits, authors or SHA…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {commits.length} of {data.count} commits · Newest first
              </p>
              <ol className="divide-y divide-border rounded-lg border border-border">
                {commits.map((commit) => (
                  <li key={commit.sha}>
                    <a
                      href={`https://github.com/pingdotgg/t3code/commit/${encodeURIComponent(commit.sha)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-ring"
                    >
                      <GitCommitHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="break-words text-sm font-medium">{commit.title}</p>
                        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{commit.author}</span>
                          {commit.date && (
                            <time dateTime={commit.date}>
                              {new Date(commit.date).toLocaleString()}
                            </time>
                          )}
                          <span className="font-mono">{commit.sha.slice(0, 7)}</span>
                        </p>
                      </div>
                      <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ol>
              {commits.length === 0 && (
                <p className="text-sm text-muted-foreground">No commits match your search.</p>
              )}
            </>
          )}
          {data?.count === 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckIcon className="size-4 text-emerald-600" />
              All upstream commits are in the published fork.
            </p>
          )}
        </WorkspacePageContainer>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/fork-updates")({ component: ForkUpdatesPage });
