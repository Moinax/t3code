import { describe, expect, it } from "vite-plus/test";
import { groupForkChanges, parseForkChange } from "./forkChanges";

describe("parseForkChange", () => {
  it("reads the type, scope, subject and pull request out of a subject line", () => {
    expect(
      parseForkChange("962428df10 feat(clients): every PR shows its code split (#22255)"),
    ).toEqual({
      sha: "962428df10",
      type: "feat",
      scope: "clients",
      title: "every PR shows its code split",
      pull: 22255,
    });
  });

  it("keeps subjects that carry no convention, so nothing is dropped from the list", () => {
    expect(parseForkChange("abc1234 just a subject")).toMatchObject({
      type: "",
      scope: null,
      title: "just a subject",
      pull: null,
    });
  });

  it("handles multiple scopes, a breaking marker, and a revert's quoted subject", () => {
    expect(
      parseForkChange("d7bc3a2f49 feat(server,web,mobile): a host says why (#22213)"),
    ).toMatchObject({ type: "feat", scope: "server,web,mobile" });
    expect(parseForkChange("aaaaaaa feat(web)!: drop the old panel")).toMatchObject({
      type: "feat",
      title: "drop the old panel",
    });
    // The quoted original must not win the grouping: what matters is the revert.
    expect(
      parseForkChange('5547d7c13c revert: "fix(web): show idle server updates" (#21950) (#22233)'),
    ).toMatchObject({ type: "revert", pull: 22233 });
  });

  it("returns null for a line with no commit at all", () => {
    expect(parseForkChange("")).toBe(null);
    expect(parseForkChange("not a commit line")).toBe(null);
  });
});

describe("groupForkChanges", () => {
  const lines = [
    "962428df10 feat(clients): every PR shows its code split (#22255)",
    "30afc56076 test(web): isolate diff worker idle clock (#22259)",
    "54346a617c fix(web,server): adding a project takes you there (#22254)",
    '8eafe058ca revert: "fix(clients): show question option previews" (#21933)',
    "72bdf1e658 perf(web): pre-bundle startup chunks (#22210)",
    "abc1234 no convention here",
  ];

  it("puts what you restart for first and what you can skip last", () => {
    expect(groupForkChanges(lines).map((group) => [group.label, group.changes.length])).toEqual([
      ["New", 1],
      ["Fixes", 1],
      ["Reverts", 1],
      ["Tests, CI and internals", 3],
    ]);
  });

  it("drops empty groups rather than showing a heading with nothing under it", () => {
    expect(groupForkChanges([lines[0] as string]).map((group) => group.key)).toEqual(["feature"]);
    expect(groupForkChanges([])).toEqual([]);
  });
});
