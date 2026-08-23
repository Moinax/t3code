import { CommandId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { normalizeThreadTitle } from "../../../textGeneration/TextGenerationUtils.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadTitleError, ThreadToolkit } from "./tools.ts";

export const setThreadTitle = Effect.fn("ThreadToolkit.setThreadTitle")(function* (input: {
  readonly title: string;
}) {
  const scope = yield* McpInvocationContext.requireMcpCapability("thread").pipe(
    Effect.mapError(
      (error) => new ThreadTitleError({ reason: "capability-unavailable", detail: error.message }),
    ),
  );

  // Blank, whitespace or bare quotes normalise to nothing. The summarizer would
  // fall back to the placeholder there; storing that would erase the thread's
  // name, so for the tool it is a failure the agent can react to.
  const title = normalizeThreadTitle(input.title);
  if (title === undefined) {
    return yield* new ThreadTitleError({
      reason: "empty-title",
      detail: "A thread title must contain at least one visible character.",
    });
  }

  const orchestrationEngine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const uuid = yield* crypto.randomUUIDv4.pipe(Effect.orDie);

  // Deliberately no `canReplaceThreadTitle` check. That guard stops *automatic*
  // writers (the first-turn summarizer) from clobbering a human rename; a tool
  // call is not automatic, the agent only makes it because the user asked. With
  // the guard the tool would silently no-op on every thread the user had
  // already renamed, which is the confusing failure.
  yield* orchestrationEngine
    .dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make(`server:thread-title-tool:${uuid}`),
      threadId: scope.threadId,
      title,
    })
    .pipe(
      Effect.mapError(
        (error) => new ThreadTitleError({ reason: "dispatch-failed", detail: error.message }),
      ),
    );

  return { title };
});

export const ThreadToolkitHandlersLive = ThreadToolkit.toLayer({
  thread_set_title: setThreadTitle,
});
