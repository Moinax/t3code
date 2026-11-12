import { getForkUpdatePreparedVersion, isForkUpdateRunning } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useForkMaintenance } from "../state/forkMaintenance";
import { useForkUpdates } from "../state/forkUpdates";
import { ForkUpdateActivity } from "./ForkUpdateActivity";
import { ForkUpdateChanges } from "./ForkUpdateChanges";
import { Button } from "./ui/button";

export function ForkMaintenancePanel() {
  const gt = useGT();
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
  // The automatic path keeps the fork level, so "nothing upstream" is ordinary and
  // should not leave a prominent primary button. Unpublished local commits are what
  // the upstream count cannot see. Only a count known to be zero demotes it: before
  // GitHub answers, nobody knows there is nothing to take.
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
      aria-label={gt("Prepare fork update")}
    >
      <div className="space-y-1" aria-live="polite">
        <h2 className="text-sm font-semibold">
          {running
            ? local
              ? gt("Installing local changes")
              : gt("Preparing upstream update")
            : failed
              ? gt("Preparation stopped")
              : ready
                ? gt("Ready to restart")
                : gt("Update your fork")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {current ? gt("You are running the prepared version.") : state.message}
        </p>
        <p className="text-xs text-muted-foreground">
          {gt("Running {version}", { version: state.runningVersion })}
          {ready
            ? ` · ${gt("Prepared {version}", { version: preparedVersion })} · ${preparedLocal ? gt("Local build") : gt("Upstream update")}`
            : ""}
          {state.targetTag ? ` · ${gt("Following {tag}", { tag: state.targetTag })}` : ""}
        </p>
      </div>
      <ForkUpdateChanges
        changes={state.changes ?? []}
        total={state.changeCount ?? 0}
        summary={state.changeSummary}
        // The two moments the question is actually being asked: deciding whether
        // to restart, and having just restarted into it.
        defaultOpen={ready || current}
      />
      <div className="space-y-3">
        <div className="flex flex-col items-start gap-3 rounded-md border border-border p-3">
          <div className="flex-1 space-y-1">
            <h3 className="text-sm font-medium">
              <T>Update from upstream</T>
            </h3>
            <p className="text-xs text-muted-foreground">
              <T>
                Keeps your fork patches, includes committed local work, and checks and builds the
                update. Publishes your fork, synchronizes local files and installs the app. Commit
                any unfinished work before starting.
              </T>
            </p>
            {blocked && (
              <p className="text-xs text-warning">
                <T>
                  The checkout has uncommitted changes. An update refuses to run over them, so
                  commit or stash your work first.
                </T>
              </p>
            )}
            {unpublished > 0 && (
              <p className="text-xs text-muted-foreground">
                {gt(
                  "{count, plural, =1 {1 fork commit is not published yet. The upstream count compares published branches, so it cannot see it. This is what publishes it.} other {{count} fork commits are not published yet. The upstream count compares published branches, so it cannot see them. This is what publishes them.}}",
                  { count: unpublished },
                )}
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
                ? gt("Finishing update…")
                : gt("Cancel update")
              : upstreamReady
                ? gt("Restart")
                : failed && !local
                  ? gt("Retry upstream update")
                  : !nothingUpstream
                    ? gt("Update fork")
                    : unpublished > 0
                      ? gt("Rebuild and publish")
                      : noChange
                        ? gt("Check for an update")
                        : gt("Rebuild from upstream")}
          </Button>
        </div>
        {state.rollbackVersion !== undefined && (
          <div className="flex flex-col items-start gap-3 rounded-md border border-border p-3">
            <div className="flex-1 space-y-1">
              <h3 className="text-sm font-medium">
                <T>Go back a build</T>
              </h3>
              <p className="text-xs text-muted-foreground">
                {state.rollbackVersion
                  ? gt(
                      "Restores {version} (the last build this app actually started, which preparing further updates never replaces) and restarts onto it. Only one build back is kept; anything older is a rebuild from git.",
                      { version: state.rollbackVersion },
                    )
                  : gt(
                      "Restores the previous build (the last build this app actually started, which preparing further updates never replaces) and restarts onto it. Only one build back is kept; anything older is a rebuild from git.",
                    )}
              </p>
              <p className="text-xs text-muted-foreground">
                <T>
                  If the app will not start at all,{" "}
                  <code className="font-mono">t3fork rollback</code> in a terminal does the same
                  thing without needing this window.
                </T>
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || running}
              onClick={() => void request("rollback")}
            >
              <T>Roll back</T>
            </Button>
          </div>
        )}
        <details
          open={local && (running || ready || failed)}
          className="rounded-md border border-border p-3"
        >
          <summary className="cursor-pointer text-sm text-muted-foreground">
            <T>Local development</T>
          </summary>
          <div className="flex flex-col items-start gap-3 pt-3">
            <div className="flex-1 space-y-1">
              <h3 className="text-sm font-medium">
                <T>Local changes</T>
              </h3>
              <p className="text-xs text-muted-foreground">
                <T>
                  Test uncommitted changes in the desktop app without publishing them. This is not
                  needed after updating your fork.
                </T>
              </p>
              {localReady ? (
                <p className="text-xs text-muted-foreground">
                  {localUpToDate
                    ? gt("Your local build is ready to restart.")
                    : gt("A build is ready to restart. Further edits can be installed afterwards.")}
                </p>
              ) : localUpToDate ? (
                <p className="text-xs text-muted-foreground">
                  <T>Your local files match the installed build.</T>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <T>This build does not commit or push your work.</T>
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
                  ? gt("Installing…")
                  : gt("Cancel installation")
                : localReady
                  ? gt("Restart")
                  : localUpToDate
                    ? gt("Up to date")
                    : failed && local
                      ? gt("Retry installation")
                      : gt("Install local changes")}
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
          <T>
            Work saved in <Var>{state.workDir}</Var>. Retrying starts a fresh attempt.
          </T>
        </p>
      )}
    </section>
  );
}
