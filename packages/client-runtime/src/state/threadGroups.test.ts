import { describe, expect, it } from "vite-plus/test";
import {
  addManualGroup,
  clusterThreadsByGroup,
  cohereGroupSections,
  layoutThreadGroups,
  ticketGroupKeyOf,
  titleWithoutGroupPrefix,
  dropManualGroup,
  groupStateLabel,
  addToManualGroup,
  planGroupDrop,
  pruneManualGroups,
  pruneUngroupedKeys,
  removeFromManualGroups,
  renameManualGroup,
  resolveGroupKey,
  suggestGroupName,
  toggleCollapsedGroup,
  ungroupedKeysWith,
  ungroupedKeysWithout,
  type ThreadGroupEntry,
} from "./threadGroups.ts";

const thread = (id: string, title: string) => ({ id, title });
type Thread = ReturnType<typeof thread>;
const keyOf = (entry: Thread) => ticketGroupKeyOf(entry.title);
const ids = (threads: readonly Thread[]) => threads.map((entry) => entry.id);
const shape = (entries: ReadonlyArray<ThreadGroupEntry<Thread>>) =>
  entries.map((entry) =>
    entry.kind === "group"
      ? `[${entry.group.name}·${entry.group.size}${entry.group.collapsed ? " folded" : ""}]`
      : `${entry.thread.id}${entry.group === null ? "" : entry.isGroupEnd ? " end" : " in"}`,
  );

describe("ticketGroupKeyOf", () => {
  it("reads the ticket id deliver puts at the start of the title", () => {
    expect(ticketGroupKeyOf("CI-6305 anorak: public bulk payroll IDs endpoint")).toBe("CI-6305");
    expect(ticketGroupKeyOf("CI-6305: Save employee payroll IDs")).toBe("CI-6305");
  });

  it("needs the separator deliver writes, so an acronym and number is not a ticket", () => {
    expect(ticketGroupKeyOf("GPT-5 eval harness")).toBeNull();
    expect(ticketGroupKeyOf("HTTP-2 upgrade path")).toBeNull();
    expect(ticketGroupKeyOf("Fix the HTTP-2 upgrade path")).toBeNull();
    expect(ticketGroupKeyOf("A-1: quick note")).toBeNull();
  });
});

describe("titleWithoutGroupPrefix", () => {
  it("drops what the group's row already says", () => {
    expect(titleWithoutGroupPrefix("CI-6236 anorak: has_home_address")).toBe("has_home_address");
    expect(titleWithoutGroupPrefix("CI-6236: Read the employee list")).toBe(
      "Read the employee list",
    );
  });

  it("leaves a title that carries nothing else", () => {
    expect(titleWithoutGroupPrefix("CI-6236:")).toBe("CI-6236:");
  });

  it("leaves an ungrouped title alone", () => {
    expect(titleWithoutGroupPrefix("Rework retries")).toBe("Rework retries");
  });
});

describe("cohereGroupSections", () => {
  const quiet = () => false;

  it("folds a whole group away behind its one still-working thread", () => {
    const result = cohereGroupSections({
      active: [thread("jacket", "CI-6305 jacket: modal"), thread("solo", "Unrelated")],
      working: [thread("anorak", "CI-6305 anorak: endpoint")],
      groupKeyOf: keyOf,
      needsAttention: quiet,
    });
    expect(ids(result.working)).toEqual(["jacket", "anorak"]);
    expect(ids(result.active)).toEqual(["solo"]);
  });

  it("pulls the whole group back when one thread wants an answer", () => {
    const result = cohereGroupSections({
      active: [thread("jacket", "CI-6305 jacket: modal")],
      working: [
        thread("anorak", "CI-6305 anorak: endpoint"),
        thread("client", "CI-6305 public-client: method"),
      ],
      groupKeyOf: keyOf,
      needsAttention: (entry) => entry.id === "jacket",
    });
    expect(ids(result.active)).toEqual(["jacket", "anorak", "client"]);
    expect(result.working).toEqual([]);
  });

  it("leaves the thread an optimistic drop just placed where the drop put it", () => {
    const dropped = thread("jacket", "CI-6305 jacket: modal");
    const result = cohereGroupSections({
      active: [dropped],
      working: [thread("anorak", "CI-6305 anorak: endpoint")],
      groupKeyOf: keyOf,
      needsAttention: quiet,
      skip: dropped,
    });
    expect(ids(result.active)).toEqual(["jacket"]);
    expect(ids(result.working)).toEqual(["anorak"]);
  });

  it("does nothing when the Working shelf is off", () => {
    const active = [
      thread("jacket", "CI-6305 jacket: modal"),
      thread("anorak", "CI-6305 anorak: endpoint"),
    ];
    const result = cohereGroupSections({
      active,
      working: [],
      groupKeyOf: keyOf,
      needsAttention: quiet,
    });
    expect(result.active).toBe(active);
  });
});

describe("clusterThreadsByGroup", () => {
  it("gathers a group at the slot of its best-placed member", () => {
    const sorted = [
      thread("a", "CI-6305 jacket: modal"),
      thread("b", "CI-6236 anorak: address"),
      thread("c", "CI-6305 anorak: endpoint"),
      thread("d", "CI-6236 jacket: read"),
      thread("e", "Unrelated"),
    ];
    expect(ids(clusterThreadsByGroup(sorted, keyOf))).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("keeps the input when no title carries a group", () => {
    const sorted = [thread("a", "Unrelated"), thread("b", "Other")];
    expect(clusterThreadsByGroup(sorted, keyOf)).toBe(sorted);
  });

  it("pulls a hand-placed member to its group like any other", () => {
    const sorted = [
      thread("placed", "CI-6305 jacket: modal"),
      thread("b", "Unrelated"),
      thread("c", "CI-6305 anorak: endpoint"),
    ];
    expect(ids(clusterThreadsByGroup(sorted, keyOf))).toEqual(["placed", "c", "b"]);
  });
});

describe("layoutThreadGroups", () => {
  const section = [
    thread("a", "CI-6236 jacket: read"),
    thread("b", "CI-6236 anorak: address"),
    thread("c", "Unrelated"),
  ];

  it("puts a group's row before its members and ends the run on the last", () => {
    const [rows] = layoutThreadGroups({
      sections: [section],
      groupKeyOf: keyOf,
      collapsed: new Set(),
    });
    expect(shape(rows!)).toEqual(["[CI-6236·2]", "a in", "b end", "c"]);
  });

  it("caps the rail on both halves of a group a hand-placed row splits", () => {
    const [rows] = layoutThreadGroups({
      sections: [
        [
          thread("a", "CI-6236 jacket: read"),
          thread("c", "Unrelated"),
          thread("b", "CI-6236 anorak: address"),
        ],
      ],
      groupKeyOf: keyOf,
      collapsed: new Set(),
    });
    expect(shape(rows!)).toEqual(["[CI-6236·2]", "a end", "c", "b end"]);
  });

  it("drops the members of a folded group and keeps its row", () => {
    const [rows] = layoutThreadGroups({
      sections: [section],
      groupKeyOf: keyOf,
      collapsed: new Set(["CI-6236"]),
    });
    expect(shape(rows!)).toEqual(["[CI-6236·2 folded]", "c"]);
  });

  it("keeps the open thread visible inside a folded group", () => {
    const [rows] = layoutThreadGroups({
      sections: [section],
      groupKeyOf: keyOf,
      collapsed: new Set(["CI-6236"]),
      keepThread: (entry) => entry.id === "b",
    });
    expect(shape(rows!)).toEqual(["[CI-6236·2 folded]", "b end", "c"]);
  });

  it("gives a thread alone on its key no group at all", () => {
    const [rows] = layoutThreadGroups({
      sections: [[thread("a", "CI-6236 jacket: read"), thread("c", "Unrelated")]],
      groupKeyOf: keyOf,
      collapsed: new Set(),
    });
    expect(shape(rows!)).toEqual(["a", "c"]);
  });

  it("counts a group across sections, so its size reads the same in each", () => {
    const [active, working] = layoutThreadGroups({
      sections: [[thread("a", "CI-6236 jacket: read")], [thread("b", "CI-6236 anorak: address")]],
      groupKeyOf: keyOf,
      collapsed: new Set(),
    });
    expect(shape(active!)).toEqual(["[CI-6236·2]", "a end"]);
    expect(shape(working!)).toEqual(["[CI-6236·2]", "b end"]);
  });

  it("names a group through nameOf when one is given", () => {
    const [rows] = layoutThreadGroups({
      sections: [section],
      groupKeyOf: keyOf,
      nameOf: () => "Payroll work",
      collapsed: new Set(),
    });
    expect(shape(rows!)[0]).toBe("[Payroll work·2]");
  });
});

describe("toggleCollapsedGroup", () => {
  const live = new Set(["CI-6305", "CI-6236"]);

  it("folds and unfolds", () => {
    expect(toggleCollapsedGroup([], "CI-6305", live)).toEqual(["CI-6305"]);
    expect(toggleCollapsedGroup(["CI-6305", "CI-6236"], "CI-6305", live)).toEqual(["CI-6236"]);
  });

  it("drops groups that no longer have a row on screen", () => {
    expect(toggleCollapsedGroup(["CI-1000", "CI-6236"], "CI-6305", live)).toEqual([
      "CI-6236",
      "CI-6305",
    ]);
  });
});

describe("manual groups", () => {
  const group = (id: string, name: string, members: string[]) => ({ id, name, members });

  it("wins over the ticket in a thread's title", () => {
    const manualGroups = [group("1", "Payroll", ["a"])];
    expect(resolveGroupKey({ manualGroups, threadKey: "a", title: "CI-6305 jacket: modal" })).toBe(
      "m:1",
    );
    expect(
      resolveGroupKey({ manualGroups, threadKey: "b", title: "CI-6305 anorak: endpoint" }),
    ).toBe("CI-6305");
  });

  it("keeps a thread taken out of its ticket's group out of it", () => {
    const manualGroups = [group("1", "Payroll", ["a", "b"])];
    const ungroupedThreadKeys = new Set(["c"]);
    const resolve = (threadKey: string) =>
      resolveGroupKey({
        manualGroups,
        ungroupedThreadKeys,
        threadKey,
        title: "CI-6305 anorak: endpoint",
      });
    expect(resolve("c")).toBe(null);
    expect(resolve("d")).toBe("CI-6305");
    // A group put together by hand is the stronger statement of the two: the
    // thread was dropped in there after it was taken out.
    expect(
      resolveGroupKey({
        manualGroups: [group("1", "Payroll", ["a", "c"])],
        ungroupedThreadKeys,
        threadKey: "c",
        title: "CI-6305 anorak: endpoint",
      }),
    ).toBe("m:1");
  });

  it("remembers a removal only for a title that would group the thread again", () => {
    const threads = [
      { key: "a", title: "CI-6305 anorak: endpoint" },
      { key: "b", title: "Rework the installer prompts" },
    ];
    expect(ungroupedKeysWith([], threads)).toEqual(["a"]);
    const once = ungroupedKeysWith([], threads);
    expect(ungroupedKeysWith(once, threads)).toBe(once);
    expect(ungroupedKeysWithout(once, ["a"])).toEqual([]);
    expect(ungroupedKeysWithout(once, ["b"])).toBe(once);
    expect(pruneUngroupedKeys(once, new Set(["a"]))).toBe(once);
    expect(pruneUngroupedKeys(once, new Set(["z"]))).toEqual([]);
  });

  it("takes threads out of the group they were in", () => {
    const before = [group("1", "Payroll", ["a", "b", "c"])];
    const after = addManualGroup(before, group("2", "Other", ["b", "d"]));
    expect(after.map((entry) => entry.members)).toEqual([
      ["a", "c"],
      ["b", "d"],
    ]);
  });

  it("drops a group the move leaves with one member", () => {
    const before = [group("1", "Payroll", ["a", "b"])];
    const after = addManualGroup(before, group("2", "Other", ["b", "d"]));
    expect(after.map((entry) => entry.id)).toEqual(["2"]);
  });

  it("drops a group that removing a member leaves with one", () => {
    const before = [group("1", "Payroll", ["a", "b"]), group("2", "Keep", ["c", "d", "e"])];
    const after = removeFromManualGroups(before, ["a", "c"]);
    expect(after.map((entry) => entry.id)).toEqual(["2"]);
    expect(after[0]?.members).toEqual(["d", "e"]);
  });

  it("renames, and refuses a blank name", () => {
    const before = [group("1", "Payroll", ["a", "b"])];
    expect(renameManualGroup(before, "m:1", "  Billing ")[0]?.name).toBe("Billing");
    expect(renameManualGroup(before, "m:1", "   ")).toBe(before);
  });

  it("ungroups by key", () => {
    const before = [group("1", "Payroll", ["a", "b"]), group("2", "Other", ["c", "d"])];
    expect(dropManualGroup(before, "m:1").map((entry) => entry.id)).toEqual(["2"]);
  });

  it("forgets threads that no longer exist, keeping identity when none did", () => {
    const before = [group("1", "Payroll", ["a", "b", "gone"]), group("2", "Other", ["c", "d"])];
    const live = new Set(["a", "b", "c", "d"]);
    expect(pruneManualGroups(before, live)[0]?.members).toEqual(["a", "b"]);
    expect(pruneManualGroups(before, new Set(["a", "b", "gone", "c", "d"]))).toBe(before);
  });

  it("suggests the ticket the threads share, when they share one", () => {
    expect(suggestGroupName(["CI-6305 jacket: a", "CI-6305 anorak: b"])).toBe("CI-6305");
    expect(suggestGroupName(["CI-6305 jacket: a", "Unrelated"])).toBe("New group");
  });
});

describe("addToManualGroup", () => {
  it("leaves a group alone when it already holds the thread", () => {
    // Taking the thread out first is what makes room for it at the end, and a
    // group of two taken down to one dissolves: adding a member it has would
    // have deleted the group.
    const groups = [{ id: "1", name: "Payroll", members: ["a", "b"] }];
    expect(addToManualGroup(groups, "m:1", "a")).toEqual(groups);
  });
});

describe("planGroupDrop", () => {
  const group = (id: string, name: string, members: string[]) => ({ id, name, members });
  const base = {
    targetGroupMembers: [] as string[],
    newGroupId: "new",
    newGroupName: "Suggested",
  };

  it("makes a group of two out of a drop on an ungrouped thread, and asks for its name", () => {
    const plan = planGroupDrop({
      ...base,
      manualGroups: [],
      draggedKey: "a",
      targetGroupKey: null,
      targetThreadKey: "b",
    });
    expect(plan?.manualGroups).toEqual([{ id: "new", name: "Suggested", members: ["b", "a"] }]);
    expect(plan?.renameKey).toBe("m:new");
  });

  it("joins a group the user already made, without asking for a name", () => {
    const plan = planGroupDrop({
      ...base,
      manualGroups: [group("1", "Payroll", ["b", "c"])],
      draggedKey: "a",
      targetGroupKey: "m:1",
      targetThreadKey: "b",
    });
    expect(plan?.manualGroups[0]?.members).toEqual(["b", "c", "a"]);
    expect(plan?.renameKey).toBeNull();
  });

  it("turns a group that was only inferred into one of the user's own", () => {
    const plan = planGroupDrop({
      ...base,
      manualGroups: [],
      draggedKey: "a",
      targetGroupKey: "CI-6378",
      targetGroupMembers: ["b", "c"],
      targetThreadKey: "b",
    });
    expect(plan?.manualGroups).toEqual([{ id: "new", name: "CI-6378", members: ["b", "c", "a"] }]);
    expect(plan?.renameKey).toBeNull();
  });

  it("does nothing when the thread is dropped on itself or on its own group", () => {
    expect(
      planGroupDrop({
        ...base,
        manualGroups: [],
        draggedKey: "a",
        targetGroupKey: null,
        targetThreadKey: "a",
      }),
    ).toBeNull();
    expect(
      planGroupDrop({
        ...base,
        manualGroups: [group("1", "Payroll", ["a", "b"])],
        draggedKey: "a",
        targetGroupKey: "m:1",
        targetThreadKey: "b",
      }),
    ).toBeNull();
  });

  it("keeps the target group alive when the dragged thread leaves another", () => {
    const plan = planGroupDrop({
      ...base,
      manualGroups: [group("1", "Keep", ["b", "c"]), group("2", "Loses", ["a", "d"])],
      draggedKey: "a",
      targetGroupKey: "m:1",
      targetThreadKey: "b",
    });
    // Group 2 dissolves (one member left) and group 1 gains the thread.
    expect(plan?.manualGroups.map((entry) => entry.id)).toEqual(["1"]);
    expect(plan?.manualGroups[0]?.members).toEqual(["b", "c", "a"]);
  });

  it("survives the target group being the one the move dissolves", () => {
    const plan = planGroupDrop({
      ...base,
      manualGroups: [group("1", "Pair", ["a", "b"])],
      draggedKey: "a",
      targetGroupKey: "m:1",
      targetThreadKey: "b",
    });
    expect(plan).toBeNull();
  });
});

describe("groupStateLabel", () => {
  it("reports the most demanding state and how many are in it", () => {
    expect(groupStateLabel(["done", "working", "attention"])).toEqual({
      tone: "attention",
      label: "1 to look at",
    });
    expect(groupStateLabel(["attention", "attention", "working"]).label).toBe("2 to look at");
    expect(groupStateLabel(["done", "working", "working"])).toEqual({
      tone: "working",
      label: "2 working",
    });
    expect(groupStateLabel(["done", "done"])).toEqual({ tone: "done", label: "Done" });
    // A group never holds fewer than two threads, but the empty case must not
    // read as something to do.
    expect(groupStateLabel([]).label).toBe("Done");
  });
});
