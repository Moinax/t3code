import { describe, expect, it } from "vite-plus/test";

import { groupTimestamp, threadTimeTimestamp } from "./threadTime.logic";

type Member = Parameters<typeof groupTimestamp>[0][number];

function member(
  isSettled: boolean,
  thread: Partial<Member["thread"]> & { readonly updatedAt: string },
): Member {
  return { isSettled, thread: { latestRun: undefined, ...thread } as Member["thread"] };
}

describe("threadTimeTimestamp", () => {
  it("prefers the last user message over the bare update", () => {
    expect(
      threadTimeTimestamp({
        latestUserMessageAt: "2026-10-28T09:00:00.000Z",
        updatedAt: "2026-10-28T11:00:00.000Z",
      }),
    ).toBe("2026-10-28T09:00:00.000Z");
    expect(
      threadTimeTimestamp({ latestUserMessageAt: null, updatedAt: "2026-10-28T11:00:00.000Z" }),
    ).toBe("2026-10-28T11:00:00.000Z");
  });
});

describe("groupTimestamp", () => {
  it("takes the most recent member", () => {
    expect(
      groupTimestamp([
        member(true, { settledAt: "2026-10-28T08:00:00.000Z", updatedAt: "2026-10-28T08:00:00Z" }),
        member(true, { settledAt: "2026-10-28T10:00:00.000Z", updatedAt: "2026-10-28T10:00:00Z" }),
        member(true, { settledAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:00:00Z" }),
      ]),
    ).toBe("2026-10-28T10:00:00.000Z");
  });

  it("reads a settled member by its settlement and an active one by its last message", () => {
    const members = [
      member(true, {
        settledAt: "2026-10-28T12:00:00.000Z",
        latestUserMessageAt: "2026-10-28T06:00:00.000Z",
        updatedAt: "2026-10-28T06:00:00.000Z",
      }),
      member(false, {
        settledAt: "2026-10-28T23:00:00.000Z",
        latestUserMessageAt: "2026-10-28T07:00:00.000Z",
        updatedAt: "2026-10-28T07:00:00.000Z",
      }),
    ];
    // The active member's settledAt is the latest stamp in the fixture and must
    // not be the one that wins: an unsettled row never shows it.
    expect(groupTimestamp(members)).toBe("2026-10-28T12:00:00.000Z");
  });

  it("compares instants rather than strings across offsets", () => {
    expect(
      groupTimestamp([
        member(false, { latestUserMessageAt: "2026-10-28T09:00:00.000Z", updatedAt: "x" }),
        member(false, { latestUserMessageAt: "2026-10-28T08:00:00.000-05:00", updatedAt: "x" }),
      ]),
    ).toBe("2026-10-28T08:00:00.000-05:00");
  });

  it("leaves the slot empty when no member can answer", () => {
    expect(groupTimestamp([])).toBeNull();
  });
});
