import { getForkUpdatePreparedVersion, isForkUpdateRunning } from "@t3tools/contracts";
import { useForkMaintenance } from "../state/forkMaintenance";
import { useForkUpdates } from "../state/forkUpdates";
import { ForkUpdateActivity } from "./ForkUpdateActivity";
import { ForkUpdateChanges } from "./ForkUpdateChanges";
import { Button } from "./ui/button";

export function ForkMaintenancePanel() {
  const { state, error, pending, request } = useForkMaintenance();
  const { data } = useForkUpdates();
  if (!state?.available)
    return error ? (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    ) : null;
  const running = isForkUpdateRunning(state.stage);
  const preparedVersion = getForkUpdatePreparedVersion(state);
  const ready = !!preparedVersion && preparedVersion !== state.runningVersion;
  const current = state.stage === "ready" && !ready;
  const local = state.source === "local";
  const preparedLocal = (state.preparedSource ?? state.source) === "local";
  const failed = state.stage === "error" || state.stage === "cancelled";
  const localUpToDate = state.localBuildStatus === "up-to-date";
  const finishing = state.stage === "publishing" || state.stage === "installing";
  const localReady = ready && preparedLocal;
  const upstreamReady = ready && !preparedLocal;
  const localAction = running && local ? "cancel" : localReady ? "restart" : "start-local";
  const upstreamAction = running && !local ? "cancel" : upstreamReady ? "restart" : "start";
  // What pressing it would actually accomplish. The automatic path keeps the
  // fork level with the nightly, so "nothing upstream" is now the ordinary
  // state — and a primary button that mostly should not be pressed is the most
  // prominent thing on the page. Local commits are the case the upstream count
  // cannot see: it compares published branches, and these are not published.
  // Only a count known to be zero demotes the button: before GitHub has been
  // reached, "rebuild" would claim there is nothing to take when nobody knows.
  const unpublished = state.unpublishedCommits ?? 0;
  const nothingUpstream = data?.count === 0;
  const worthStarting = !nothingUpstream || unpublished > 0 || failed;
  // A run refuses outright over uncommitted files, so offering it is offering a
  // failure. Disabled rather than relabelled: there is no wording that makes a
  // button that cannot run useful.
  const blocked = state.localClean === false;
  // And the four conditions under which a run returns without building anything.
  // `runningIsHead` is the one the app cannot work out for itself; absent on an
  // older runner, which leaves the honest "rebuild" rather than claiming a
  // no-op nobody verified.
  const noChange = nothingUpstream && unpublished === 0 && state.runningIsHead === true;
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label="Prepare fork update"
    >
      <div className="space-y-1" aria-live="polite">
        <h2 className="text-sm font-semibold">
          {running
            ? local
              ? "Installing local changes"
              : "Preparing upstream update"
            : failed
              ? "Preparation stopped"
              : ready
                ? "Ready to restart"
                : "Update your fork"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {current ? "You are running the prepared version." : state.message}
        </p>
        <p className="text-xs text-muted-foreground">
          Running {state.runningVersion}
          {ready
            ? ` · Prepared ${preparedVersion} · ${preparedLocal ? "Local build" : "Upstream update"}`
            : ""}
          {state.targetTag ? ` · Following ${state.targetTag}` : ""}
        </p>
      </div>
      <ForkUpdateChanges
        changes={state.changes ?? []}
        total={state.changeCount ?? 0}
        local={preparedLocal}
        // The two moments the question is actually being asked: deciding whether
        // to restart, and having just restarted into it.
        defaultOpen={ready || current}
      />
      <div className="space-y-3">
        <div className="flex flex-col items-start gap-3 rounded-md border border-border p-3">
          <div className="flex-1 space-y-1">
            <h3 className="text-sm font-medium">Update from upstream</h3>
            <p className="text-xs text-muted-foreground">
              Keeps your fork patches, includes committed local work, and checks and builds the
              update. Publishes your fork, synchronizes local files and installs the app. Commit any
              unfinished work before starting.
            </p>
            {blocked && (
              <p className="text-xs text-warning">
                The checkout has uncommitted changes. An update refuses to run over them, so commit
                or stash your work first.
              </p>
            )}
            {unpublished > 0 && (
              <p className="text-xs text-muted-foreground">
                {unpublished} fork {unpublished === 1 ? "commit is" : "commits are"} not published
                yet. The upstream count compares published branches, so it cannot see
                {unpublished === 1 ? " it" : " them"} — this is what publishes
                {unpublished === 1 ? " it" : " them"}.
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant={running || upstreamReady || worthStarting ? "default" : "outline"}
            disabled={
              pending || (running ? local || finishing : upstreamReady ? !!error : ready || blocked)
            }
            onClick={() => void request(upstreamAction)}
          >
            {running && !local
              ? finishing
                ? "Finishing update…"
                : "Cancel update"
              : upstreamReady
                ? "Restart"
                : failed && !local
                  ? "Retry upstream update"
                  : !nothingUpstream
                    ? "Update fork"
                    : unpublished > 0
                      ? "Rebuild and publish"
                      : noChange
                        ? "Check for an update"
                        : "Rebuild from upstream"}
          </Button>
        </div>
        {state.rollbackVersion !== undefined && (
          <div className="flex flex-col items-start gap-3 rounded-md border border-border p-3">
            <div className="flex-1 space-y-1">
              <h3 className="text-sm font-medium">Go back a build</h3>
              <p className="text-xs text-muted-foreground">
                Restores {state.rollbackVersion || "the previous build"} — the last build this app
                actually started, which preparing further updates never replaces — and restarts onto
                it. Only one build back is kept; anything older is a rebuild from git.
              </p>
              <p className="text-xs text-muted-foreground">
                If the app will not start at all, <code className="font-mono">t3fork rollback</code>{" "}
                in a terminal does the same thing without needing this window.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || running}
              onClick={() => void request("rollback")}
            >
              Roll back
            </Button>
          </div>
        )}
        <details
          open={local && (running || ready || failed)}
          className="rounded-md border border-border p-3"
        >
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Local development
          </summary>
          <div className="flex flex-col items-start gap-3 pt-3">
            <div className="flex-1 space-y-1">
              <h3 className="text-sm font-medium">Local changes</h3>
              <p className="text-xs text-muted-foreground">
                Test uncommitted changes in the desktop app without publishing them. This is not
                needed after updating your fork.
              </p>
              {localReady ? (
                <p className="text-xs text-muted-foreground">
                  {localUpToDate
                    ? "Your local build is ready to restart."
                    : "A build is ready to restart. Further edits can be installed afterwards."}
                </p>
              ) : localUpToDate ? (
                <p className="text-xs text-muted-foreground">
                  Your local files match the installed build.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  This build does not commit or push your work.
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={
                pending || (running ? !local || finishing : localReady ? !!error : localUpToDate)
              }
              onClick={() => void request(localAction)}
            >
              {running && local
                ? finishing
                  ? "Installing…"
                  : "Cancel installation"
                : localReady
                  ? "Restart"
                  : localUpToDate
                    ? "Up to date"
                    : failed && local
                      ? "Retry installation"
                      : "Install local changes"}
            </Button>
          </div>
        </details>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {(state.log || running) && (
        <ForkUpdateActivity
          key={state.runId}
          log={state.log}
          running={running}
          defaultOpen={running || state.stage === "error"}
        />
      )}
      {state.workDir && (state.stage === "error" || state.stage === "cancelled") && (
        <p className="break-all text-xs text-muted-foreground">
          Work saved in {state.workDir}. Retrying starts a fresh attempt.
        </p>
      )}
    </section>
  );
}
