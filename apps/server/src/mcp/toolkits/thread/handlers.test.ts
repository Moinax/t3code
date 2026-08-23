import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationCommand,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { setThreadTitle } from "./handlers.ts";

const threadId = ThreadId.make("thread-1");

const scope = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("claude-code"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const run = (
  title: string,
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["thread"],
) =>
  Effect.gen(function* () {
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const result = yield* setThreadTitle({ title }).pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope(capabilities)),
      Effect.provideService(OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch: (command) =>
          Ref.update(dispatched, (commands) => [...commands, command]).pipe(
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.empty,
        latestSequence: Effect.succeed(0),
      }),
      Effect.provideService(
        Crypto.Crypto,
        Crypto.make({
          randomBytes: (size) => new Uint8Array(size),
          digest: (_algorithm, data) => Effect.succeed(data),
        }),
      ),
      Effect.result,
    );
    return { result, commands: yield* Ref.get(dispatched) };
  });

it.effect("dispatches thread.meta.update with the normalized title", () =>
  Effect.gen(function* () {
    const { result, commands } = yield* run('  "Ship the OCT-658 rename"\n and more  ');

    expect(result).toMatchObject({
      _tag: "Success",
      success: { title: "Ship the OCT-658 rename" },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "thread.meta.update",
      threadId,
      title: "Ship the OCT-658 rename",
    });
  }),
);

it.effect("renames a thread the user already titled by hand", () =>
  Effect.gen(function* () {
    const { commands } = yield* run("Agent-chosen title");
    expect(commands).toHaveLength(1);
  }),
);

it.effect("fails without dispatching when the credential lacks the capability", () =>
  Effect.gen(function* () {
    const { result, commands } = yield* run("A real title", ["preview"]);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ThreadTitleError", reason: "capability-unavailable" },
    });
    expect(commands).toEqual([]);
  }),
);

it.effect("accepts a rename to the placeholder label", () =>
  Effect.gen(function* () {
    // "New thread" is what an untitled thread shows; asking for it back is a
    // legitimate rename, not an empty title.
    const { commands } = yield* run("New thread");
    expect(commands).toHaveLength(1);
  }),
);

it.effect("rejects a title that normalizes to nothing", () =>
  Effect.gen(function* () {
    for (const title of ["", "   ", '"""', "\n\t"]) {
      const { result, commands } = yield* run(title);
      expect(result, `"${title}" must be rejected`).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ThreadTitleError", reason: "empty-title" },
      });
      expect(commands).toEqual([]);
    }
  }),
);
