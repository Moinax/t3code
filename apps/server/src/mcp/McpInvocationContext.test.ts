import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "./McpInvocationContext.ts";

const invocation = (
  capabilities: ReadonlySet<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  issuedAt: 1,
});

it.effect("reports the scoped credential context when a capability is unavailable", () => {
  const scope = invocation(new Set());

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireMcpCapability("preview").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.flip,
    );

    expect(error).toBeInstanceOf(McpInvocationContext.McpCapabilityUnavailableError);
    expect(error).toMatchObject({
      capability: "preview",
      environmentId: scope.environmentId,
      threadId: scope.threadId,
      providerSessionId: scope.providerSessionId,
      providerInstanceId: scope.providerInstanceId,
    });
    expect(error.message).toBe("MCP credential does not grant the preview capability.");
  });
});

it.effect("names the capability the tool asked for", () => {
  const scope = invocation(new Set(["preview"]));

  return Effect.gen(function* () {
    const error = yield* McpInvocationContext.requireMcpCapability("thread").pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
      Effect.flip,
    );

    expect(error.capability).toBe("thread");
    expect(error.message).toBe("MCP credential does not grant the thread capability.");
  });
});
