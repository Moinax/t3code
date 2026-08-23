import { it as effectIt } from "@effect/vitest";
import {
  EnvironmentId,
  PreviewAutomationUnavailableError,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import { normalizePreviewOpenInput, PreviewToolkitHandlersLive } from "./handlers.ts";
import { PreviewToolkit } from "./tools.ts";

describe("normalizePreviewOpenInput", () => {
  it("leaves an unstated visibility for the client preference to decide", () => {
    // Filling `open` in here would outrank `browserAutoShowFloatingPreview`,
    // which is desktop-local and cannot be read from the server.
    expect(normalizePreviewOpenInput({})).toEqual({ reuseExistingTab: true });
  });

  it("preserves an explicit background-only opt-out", () => {
    expect(normalizePreviewOpenInput({ open: false })).toEqual({
      open: false,
      reuseExistingTab: true,
      show: false,
    });
  });

  it("supports show as a legacy alias while preferring open", () => {
    expect(normalizePreviewOpenInput({ show: false })).toEqual({
      open: false,
      reuseExistingTab: true,
      show: false,
    });
    expect(normalizePreviewOpenInput({ open: true, show: false })).toEqual({
      open: true,
      reuseExistingTab: true,
      show: true,
    });
  });
});

describe("preview capability failures", () => {
  effectIt.effect("still reports the contract error when the credential lacks the capability", () =>
    Effect.gen(function* () {
      // `requireMcpCapability` fails with the toolkit-agnostic
      // `McpCapabilityUnavailableError`; the preview tools declare
      // `PreviewAutomationError`, so the remap in `invoke` is what keeps the
      // tag the MCP client and `PreviewAutomationBroker` both switch on.
      const scope: McpInvocationContext.McpInvocationScope = {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: ThreadId.make("thread-1"),
        providerSessionId: "provider-session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set(),
        issuedAt: 1,
      };

      const error = yield* PreviewToolkit.pipe(
        Effect.flatMap((toolkit) => toolkit.handle("preview_status", {})),
        Effect.flatMap(Stream.runCollect),
        Effect.provide(PreviewToolkitHandlersLive),
        Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
        Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, {
          connect: () => Effect.die("the broker must not be reached"),
          focusHost: () => Effect.die("the broker must not be reached"),
          respond: () => Effect.die("the broker must not be reached"),
          invoke: () => Effect.die("the broker must not be reached"),
        }),
        Effect.flip,
      );

      expect(error).toBeInstanceOf(PreviewAutomationUnavailableError);
      expect(error).toMatchObject({
        _tag: "PreviewAutomationUnavailableError",
        capability: "preview",
        threadId: scope.threadId,
        providerSessionId: scope.providerSessionId,
      });
    }),
  );
});
