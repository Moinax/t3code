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
                : "Update this desktop"}
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
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col items-start gap-3 rounded-md border border-border p-3">
          <div className="flex-1 space-y-1">
            <h3 className="text-sm font-medium">Upstream update</h3>
            <p className="text-xs text-muted-foreground">
              Fetches upstream changes into the published fork. Sol High Fast fixes conflicts and
              failed checks, then the verified update is built, published and installed.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
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
                  : "Prepare upstream update"}
          </Button>
        </div>
        <div className="flex flex-col items-start gap-3 rounded-md border border-border p-3">
          <div className="flex-1 space-y-1">
            <h3 className="text-sm font-medium">Local changes</h3>
            <p className="text-xs text-muted-foreground">
              Checks, builds and installs your local changes. Restart when you are ready to use
              them.
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
                Ask your coding agent to manage commits, publication and branch synchronization.
              </p>
            )}
          </div>
          <Button
            size="sm"
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
