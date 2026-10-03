import { getForkUpdatePreparedVersion, isForkUpdateRunning } from "@t3tools/contracts";
import { useForkMaintenance } from "../state/forkMaintenance";
import { ForkUpdateActivity } from "./ForkUpdateActivity";
import { Button } from "./ui/button";

export function ForkMaintenancePanel() {
  const { state, error, pending, request } = useForkMaintenance();
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
        </p>
      </div>
      <div className="space-y-3">
        <div className="flex flex-col items-start gap-3 rounded-md border border-border p-3">
          <div className="flex-1 space-y-1">
            <h3 className="text-sm font-medium">Update from upstream</h3>
            <p className="text-xs text-muted-foreground">
              Keeps your fork patches, includes committed local work, and checks and builds the
              update. Publishes your fork, synchronizes local files and installs the app. Commit any
              unfinished work before starting.
            </p>
          </div>
          <Button
            size="sm"
            disabled={pending || (running ? local || finishing : upstreamReady ? !!error : ready)}
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
                  : "Update fork"}
          </Button>
        </div>
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
