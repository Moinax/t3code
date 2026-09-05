import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildUsageLimitsHoverRows } from "./UsageLimits";

const now = Date.parse("2026-09-04T12:00:00.000Z");

function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex-personal"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Personal",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-04T11:59:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt: "2026-09-04T11:59:00.000Z",
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 42.4,
          resetsAt: "2026-09-04T14:15:00.000Z",
          windowDurationMins: 300,
        },
      ],
    },
    ...overrides,
  };
}

describe("buildUsageLimitsHoverRows", () => {
  it("keeps only the current machine's instances, usage and reset information", () => {
    const rows = buildUsageLimitsHoverRows(
      [
        {
          environmentId: EnvironmentId.make("desktop"),
          environmentLabel: "Desktop",
          providers: [provider()],
        },
        {
          environmentId: EnvironmentId.make("remote"),
          environmentLabel: "Remote",
          providers: [
            provider({
              instanceId: ProviderInstanceId.make("codex-remote"),
              displayName: "Remote",
            }),
          ],
        },
      ],
      EnvironmentId.make("desktop"),
      now,
    );

    expect(rows).toHaveLength(1);
    expect(rows).toMatchObject([
      {
        key: "desktop:codex-personal",
        driverLabel: "Codex",
        instanceLabel: "Personal",
        notice: null,
        windows: [
          {
            id: "five_hour",
            label: "Session",
            usedPercent: 42.4,
            resetsIn: "resets in 2h 15m",
          },
        ],
      },
    ]);
  });

  it("keeps an unavailable explanation instead of inventing a quota bar", () => {
    const rows = buildUsageLimitsHoverRows(
      [
        {
          environmentId: EnvironmentId.make("desktop"),
          environmentLabel: null,
          providers: [
            provider({
              usageLimits: {
                checkedAt: "2026-09-04T11:59:00.000Z",
                windows: [],
                unavailable: {
                  reason: "unsupported",
                  message: "API-key accounts do not report subscription limits.",
                },
              },
            }),
          ],
        },
      ],
      EnvironmentId.make("desktop"),
      now,
    );

    expect(rows[0]).toMatchObject({
      notice: "API-key accounts do not report subscription limits.",
      windows: [],
    });
  });

  it("returns no rows until the current machine is known", () => {
    const rows = buildUsageLimitsHoverRows(
      [
        {
          environmentId: EnvironmentId.make("remote"),
          environmentLabel: "Remote",
          providers: [provider()],
        },
      ],
      null,
      now,
    );

    expect(rows).toEqual([]);
  });
});
