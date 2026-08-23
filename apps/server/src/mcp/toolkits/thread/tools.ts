import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export class ThreadTitleError extends Schema.TaggedErrorClass<ThreadTitleError>()(
  "ThreadTitleError",
  {
    reason: Schema.Literals(["capability-unavailable", "empty-title", "dispatch-failed"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ThreadSetTitleTool = Tool.make("thread_set_title", {
  description:
    "Rename the thread this agent session is running in, as it appears in the T3 Code sidebar. Use it once you know what the work actually is — for example after resolving the ticket a slash command only named by its id. The title is normalized to a single line of at most 50 characters.",
  parameters: Schema.Struct({
    title: Schema.String.annotate({
      description: "The new thread title: a short human-readable label, not a sentence.",
    }),
  }),
  success: Schema.Struct({
    title: Schema.String.annotate({ description: "The title as stored, after normalization." }),
  }),
  failure: ThreadTitleError,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    OrchestrationEngineService,
    Crypto.Crypto,
  ],
})
  .annotate(Tool.Title, "Set thread title")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)
  .annotate(Tool.Idempotent, true);

export const ThreadToolkit = Toolkit.make(ThreadSetTitleTool);
