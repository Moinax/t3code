import * as Schema from "effect/Schema";

export const ForkUpdateAction = Schema.Literals([
  "status",
  "start",
  "start-local",
  "cancel",
  "restart",
]);
export type ForkUpdateAction = typeof ForkUpdateAction.Type;
export const ForkUpdateState = Schema.Struct({
  available: Schema.Boolean,
  source: Schema.optionalKey(Schema.Literals(["upstream", "local"])),
  preparedVersion: Schema.optionalKey(Schema.String),
  preparedSource: Schema.optionalKey(Schema.Literals(["upstream", "local"])),
  localBuildStatus: Schema.optionalKey(Schema.Literals(["up-to-date", "changed", "unknown"])),
  stage: Schema.Literals([
    "idle",
    "starting",
    "snapshotting",
    "fetching",
    "rebasing",
    "repairing",
    "checking",
    "building",
    "publishing",
    "installing",
    "ready",
    "error",
    "cancelled",
  ]),
  message: Schema.String,
  updatedAt: Schema.Number,
  commit: Schema.NullOr(Schema.String),
  version: Schema.NullOr(Schema.String),
  runningVersion: Schema.String,
  runId: Schema.NullOr(Schema.String),
  workDir: Schema.NullOr(Schema.String),
  attempt: Schema.Number,
  log: Schema.String,
});
export type ForkUpdateState = typeof ForkUpdateState.Type;
export function getForkUpdatePreparedVersion(state: ForkUpdateState): string | null {
  return state.preparedVersion ?? (state.stage === "ready" ? state.version : null);
}
export function isForkUpdateRunning(stage: ForkUpdateState["stage"]): boolean {
  return !["idle", "ready", "error", "cancelled"].includes(stage);
}
