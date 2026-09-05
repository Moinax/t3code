import * as Schema from "effect/Schema";

export const ForkUpdateAction = Schema.Literals(["status", "start", "cancel", "restart"]);
export type ForkUpdateAction = typeof ForkUpdateAction.Type;
export const ForkUpdateState = Schema.Struct({
  available: Schema.Boolean,
  stage: Schema.Literals([
    "idle",
    "starting",
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
export function isForkUpdateRunning(stage: ForkUpdateState["stage"]): boolean {
  return !["idle", "ready", "error", "cancelled"].includes(stage);
}
