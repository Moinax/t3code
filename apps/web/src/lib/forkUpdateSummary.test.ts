import type { ForkUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { summarizeForkUpdates } from "./forkUpdateSummary";

const job: ForkUpdateState = {
  available: true,
  stage: "idle",
  message: "Ready to check for an update.",
  updatedAt: 1,
  commit: null,
  version: null,
  runningVersion: "1.0.0-moinax.abc123",
  runId: null,
  workDir: null,
  attempt: 0,
  log: "",
  localClean: true,
};
const updates = {
  count: 0,
  nightly: { tag: "v0.1.1-nightly.20261020.3411", eligibleAt: null },
};
const summarize = (overrides: Partial<Parameters<typeof summarizeForkUpdates>[0]> = {}) =>
  summarizeForkUpdates({ job, updates, checkFailed: false, loading: false, ...overrides });

describe("summarizeForkUpdates", () => {
  it("says nothing with a badge when the fork is level with the nightly it follows", () => {
    const summary = summarize();
    expect(summary.badge).toBe(null);
    expect(summary.label).toContain("up to date");
    expect(summary.label).toContain("v0.1.1-nightly.20261020.3411");
  });

  it("never claims to be up to date while commits are missing", () => {
    // Whatever the reason the automatic path has not taken them — a cancelled
    // run, a dirty checkout, a runner too old to report cleanliness — the one
    // surface that reports drift must not assert the opposite.
    for (const localClean of [true, false, undefined] as const) {
      const state: ForkUpdateState = { ...job };
      if (localClean === undefined) delete (state as { localClean?: boolean }).localClean;
      else (state as { localClean?: boolean }).localClean = localClean;
      const summary = summarize({ job: state, updates: { ...updates, count: 7 } });
      expect(summary.label).not.toContain("up to date");
      expect(summary.label).toContain("7");
      expect(summary.badge).toBe("7");
      expect(summary.tone).toBe("warning");
    }
  });

  it("explains a stall only when the checkout is what causes it", () => {
    const behind = { ...updates, count: 3 };
    expect(summarize({ job: { ...job, localClean: false }, updates: behind }).label).toContain(
      "uncommitted changes",
    );
    expect(summarize({ job: { ...job, localClean: true }, updates: behind }).label).not.toContain(
      "uncommitted changes",
    );
  });

  it("puts a run, a prepared build and a failure ahead of the count", () => {
    const behind = { ...updates, count: 7 };
    expect(
      summarize({ job: { ...job, stage: "building", message: "Building…" }, updates: behind }),
    ).toMatchObject({ running: true, badge: null });
    expect(
      summarize({
        job: { ...job, stage: "ready", version: "1.0.0-moinax.def456" },
        updates: behind,
      }),
    ).toMatchObject({ badge: "✓", tone: "success" });
    expect(summarize({ job: { ...job, stage: "error" }, updates: behind })).toMatchObject({
      badge: "!",
      tone: "warning",
    });
  });

  it("caps the count and reports a failed check without losing the last one", () => {
    expect(summarize({ updates: { ...updates, count: 1500 } }).badge).toBe("999+");
    expect(summarize({ checkFailed: true, updates: { ...updates, count: 7 } }).label).toContain(
      "last count 7",
    );
    expect(summarize({ updates: null, loading: true }).label).toContain("checking GitHub");
    expect(summarize({ updates: null, loading: false }).badge).toBe(null);
  });
});
