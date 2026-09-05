import { isForkUpdateRunning } from "@t3tools/contracts";
import { useForkMaintenance } from "../state/forkMaintenance";
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
  const ready = state.stage === "ready" && state.version !== state.runningVersion;
  const current = state.stage === "ready" && !ready;
  const finishing = state.stage === "publishing" || state.stage === "installing";
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label="Prepare fork update"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1" aria-live="polite">
          <h2 className="text-sm font-semibold">
            {ready ? "Ready to restart" : running ? "Preparing update" : "Update this desktop"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {current ? "You are running the prepared version." : state.message}
          </p>
          <p className="text-xs text-muted-foreground">
            Running {state.runningVersion}
            {ready ? ` · Prepared ${state.version}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {ready ? (
            <Button size="sm" disabled={pending || !!error} onClick={() => void request("restart")}>
              Restart
            </Button>
          ) : running ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || finishing}
              onClick={() => void request("cancel")}
            >
              Cancel update
            </Button>
          ) : (
            <Button size="sm" disabled={pending} onClick={() => void request("start")}>
              {state.stage === "error" || state.stage === "cancelled"
                ? "Retry update"
                : "Prepare update"}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Updates this computer from the published fork. Sol High Fast fixes conflicts and failed
        checks when needed. After verification, the update is built, pushed and installed. You
        choose when to restart.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {state.log && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Update activity
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
            {state.log}
          </pre>
        </details>
      )}
      {state.workDir && (state.stage === "error" || state.stage === "cancelled") && (
        <p className="break-all text-xs text-muted-foreground">
          Work saved in {state.workDir}. Retrying starts a fresh attempt.
        </p>
      )}
    </section>
  );
}
