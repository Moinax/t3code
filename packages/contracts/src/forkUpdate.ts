import * as Schema from "effect/Schema";

export const ForkUpdateAction = Schema.Literals([
  "status",
  "start",
  "start-local",
  "cancel",
  "restart",
  "rollback",
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
  /** The upstream nightly release this update follows, and the commits it brings in. */
  /** False when the checkout has edits of its own, which holds back the automatic update. */
  localClean: Schema.optionalKey(Schema.Boolean),
  /** The build a rollback restores, null when one exists but predates being named. */
  rollbackVersion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  /** Fork commits this machine has not published; the upstream count cannot see them. */
  unpublishedCommits: Schema.optionalKey(Schema.Number),
  /** Whether the running app was built from the checkout's HEAD, so a run would rebuild nothing. */
  runningIsHead: Schema.optionalKey(Schema.Boolean),
  targetTag: Schema.optionalKey(Schema.NullOr(Schema.String)),
  changes: Schema.optionalKey(Schema.Array(Schema.String)),
  changeCount: Schema.optionalKey(Schema.Number),
});
export type ForkUpdateState = typeof ForkUpdateState.Type;
export function getForkUpdatePreparedVersion(state: ForkUpdateState): string | null {
  return state.preparedVersion ?? (state.stage === "ready" ? state.version : null);
}
export function isForkUpdateRunning(stage: ForkUpdateState["stage"]): boolean {
  return !["idle", "ready", "error", "cancelled"].includes(stage);
}
