import {
  CommandId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type PullRequestChecksState,
  type PullRequestUnavailableError,
  type PullRequestWatchUntil,
  type ThreadPullRequestWatch,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { evaluatePullRequestWatch } from "../orchestration-v2/pullRequestWatch.ts";
import * as PullRequestService from "./PullRequestService.ts";
import {
  resolveTarget,
  type PullRequestTarget,
  type PullRequestTargetError,
  type ResolvedTarget,
} from "./pullRequestTarget.ts";
import {
  threadPullRequestKeysEqual,
  threadPullRequestsOf,
} from "../sourceControl/threadPullRequests.ts";

export class PullRequestWatchFailedError extends Schema.TaggedError<PullRequestWatchFailedError>()(
  "PullRequestWatchFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not change whether the pull request is watched.";
  }
}

export class PullRequestWatchFromSubagentError extends Schema.TaggedError<PullRequestWatchFromSubagentError>()(
  "PullRequestWatchFromSubagentError",
  {},
) {
  override get message(): string {
    return "This thread is a subagent, so it cannot watch pull requests. Its parent thread owns the pull request: finish your task and report back instead.";
  }
}

export class PullRequestWatchThreadNotFoundError extends Schema.TaggedError<PullRequestWatchThreadNotFoundError>()(
  "PullRequestWatchThreadNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class PullRequestWatchService extends Context.Service<
  PullRequestWatchService,
  {
    readonly setWatching: (input: {
      readonly threadId: ThreadId;
      readonly target: PullRequestTarget;
      readonly watching: boolean;
      readonly until?: PullRequestWatchUntil | undefined;
    }) => Effect.Effect<
      ResolvedTarget & {
        readonly watching: boolean;
        readonly wasWatching: boolean;
        /** Set when the PR already ended, so no watch was registered. */
        readonly state?: "merged" | "closed";
        /** CI as the start read saw it. Checks that already finished never wake the watch. */
        readonly checksState?: PullRequestChecksState;
      },
      | PullRequestWatchFailedError
      | PullRequestWatchFromSubagentError
      | PullRequestWatchThreadNotFoundError
      | PullRequestTargetError
      | PullRequestUnavailableError
    >;
  }
>()("t3/pullRequest/PullRequestWatchService") {}

// A failure outranks pending checks: the watch already recorded it, so it will not wake for it.
const baselineChecks = (watch: ThreadPullRequestWatch | undefined) =>
  watch === undefined || watch.awaitingBaseline === "checks"
    ? undefined
    : watch.passed
      ? ("passing" as const)
      : watch.failedChecks.length > 0
        ? ("failing" as const)
        : watch.checksPending
          ? ("pending" as const)
          : undefined;

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const random = yield* SecureRandom.SecureRandom;

  const requireThread = Effect.fn("PullRequestWatchService.requireThread")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* engine
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => new PullRequestWatchFailedError({ cause })));
    if (thread === null || thread.deletedAt !== null) {
      return yield* new PullRequestWatchThreadNotFoundError({ threadId });
    }
    return thread;
  });

  // Keep the registration span stable across the service extraction.
  const setWatching = Effect.fn("PullRequestsToolkit.setWatching")(function* (input: {
    readonly threadId: ThreadId;
    readonly target: PullRequestTarget;
    readonly watching: boolean;
    readonly until?: PullRequestWatchUntil | undefined;
  }) {
    const { watching } = input;
    const thread = yield* requireThread(input.threadId);
    const project = yield* pullRequests
      .addressedProject(thread.projectId)
      .pipe(Effect.mapError((cause) => new PullRequestWatchFailedError({ cause })));
    const target = yield* resolveTarget(input.target, project);
    const watchedLink = (shell: OrchestrationV2ThreadShell) =>
      threadPullRequestsOf(shell).find(
        (link) => link.source !== "stack-dismissed" && threadPullRequestKeysEqual(link, target),
      );
    if (watching && thread.lineage.relationshipToParent === "subagent") {
      return yield* new PullRequestWatchFromSubagentError();
    }
    const before = watchedLink(thread);
    const wasWatching = before?.watch !== undefined;
    // A watch on an ended PR could only report that it ended, so report it now instead.
    const alreadyEnded = (state: "merged" | "closed") => ({
      ...target,
      watching: false,
      wasWatching,
      state,
    });
    // A closed snapshot still gets a read below, since the PR may have reopened.
    if (watching && before?.snapshot?.state === "merged") return alreadyEnded("merged");
    // This read is the watch's baseline and the agent is shown it, so checks finishing between
    // the agent's own look and the watch's first read still wake it.
    let baseline: ThreadPullRequestWatch | undefined;
    if (watching && !wasWatching) {
      const reference = {
        projectId: thread.projectId,
        host: target.host,
        repository: target.repository,
        number: target.number,
      };
      yield* pullRequests.invalidate({ reference });
      const detail = yield* pullRequests.detail({ ...reference, allowStale: false }).pipe(
        Effect.asSome,
        Effect.catchTags({
          // Host and transport errors can recover while the watch is active.
          PullRequestOperationError: () => Effect.succeedNone,
        }),
      );
      if (Option.isSome(detail)) {
        const { state } = detail.value;
        if (state === "merged" || state === "closed") return alreadyEnded(state);
        const now = yield* Clock.currentTimeMillis;
        const startedAt = DateTime.formatIso(DateTime.makeUnsafe(now));
        baseline = evaluatePullRequestWatch(
          {
            startedAt,
            headSha: null,
            failedChecks: [],
            passed: false,
            passedChecks: [],
            conflicting: false,
            awaitingBaseline: "all",
            remarksThrough: startedAt,
            remarkIds: [],
            wakes: 0,
          },
          detail.value,
          null,
          now,
        ).next;
      }
    }
    const uuid = yield* random.uuidV4().pipe(Effect.orDie);
    yield* engine
      .dispatch({
        type: "thread.pull-request.watch",
        commandId: CommandId.make(`server:mcp-pr-watch:${thread.id}:${uuid}`),
        threadId: thread.id,
        host: target.host,
        repository: target.repository,
        number: target.number,
        watching,
        ...(watching ? { link: { url: target.url, source: "agent" as const } } : {}),
        ...(watching && input.until !== undefined && { until: input.until }),
        ...(baseline === undefined ? {} : { baseline }),
      })
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.fail(new PullRequestWatchFailedError({ cause })),
        ),
      );
    const after = yield* requireThread(thread.id);
    const checksState = baselineChecks(baseline);
    return {
      ...target,
      watching: watchedLink(after)?.watch !== undefined,
      wasWatching,
      ...(checksState === undefined ? {} : { checksState }),
    };
  });

  return PullRequestWatchService.of({ setWatching });
});

export const layer = Layer.effect(PullRequestWatchService, make);
