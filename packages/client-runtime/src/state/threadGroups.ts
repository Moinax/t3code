/**
 * A ticket delivered across several repos becomes one thread per repo, each in
 * its own project, scattered through the flat inbox by arrival time. These
 * helpers gather such threads into a group: a row of its own that names the
 * group and folds its members away, with the members as ordinary rows beneath.
 *
 * Members are equal. The group is not one of its threads, so no member owns it
 * and none is special when it folds.
 *
 * Cohesion stops at the live sections. Pinning, snoozing and settling are
 * explicit, server-held decisions about one thread: a sibling must not undo
 * them, and a settled thread pulled back into the inbox would only be
 * auto-settled again. Active and Working are derived client side and are not
 * drop targets, so moving a thread between them is a render concern alone.
 *
 * The layout is shared so every client lays a group out the same way; only the
 * rows themselves are drawn per client.
 */

export interface GroupableThread {
  readonly title: string;
}

export interface ThreadGroup {
  /** Stable identity, and what a fold is remembered by. */
  readonly key: string;
  /** What the group's row shows. Equal to the key for a ticket group. */
  readonly name: string;
  /** Members across every live section, not just the one being laid out. */
  readonly size: number;
  readonly collapsed: boolean;
}

export type ThreadGroupEntry<T> =
  | { readonly kind: "group"; readonly group: ThreadGroup }
  | {
      readonly kind: "thread";
      readonly thread: T;
      /** The group this row belongs to, for the rail; null when ungrouped. */
      readonly group: ThreadGroup | null;
      /** Last member of its group in this section, so the rail can end. */
      readonly isGroupEnd: boolean;
    };

/**
 * A ticket id at the head of the title, followed by the separator `/deliver`
 * writes: `CI-6305: …` or `CI-6305 anorak: …`. The colon is what makes this a
 * ticket rather than any acronym-and-number — without it, `GPT-5 eval harness`
 * and `HTTP-2 upgrade path` would group as tickets `GPT-5` and `HTTP-2`.
 */
const TICKET_ID = /^\s*([A-Z][A-Z0-9]+-\d+)(?::|\s+[\w@./-]+:)/;

export function ticketGroupKeyOf(title: string): string | null {
  return TICKET_ID.exec(title)?.[1] ?? null;
}

/**
 * The part of a member's title the group's row already says. Clients drop it
 * from the displayed title and keep the whole title everywhere it is read
 * aloud or copied.
 */
export function titleWithoutGroupPrefix(title: string): string {
  const match = TICKET_ID.exec(title);
  if (match === null) return title;
  const rest = title.slice(match[0].length).trim();
  // A title that is nothing but its prefix would be left blank.
  return rest.length === 0 ? title : rest;
}

function groupThreads<T>(
  threads: readonly T[],
  groupKeyOf: (thread: T) => string | null,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const thread of threads) {
    const key = groupKeyOf(thread);
    if (key === null) continue;
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [thread]);
    else members.push(thread);
  }
  return groups;
}

/**
 * Give every thread of a group the same live section. A member that wants
 * something from the user pulls the whole group back into Active; short of
 * that, one member still working folds the group away with it, because the
 * group is the unit of attention and it is not finished.
 *
 * `skip` is the thread an optimistic drop just placed. Relocating it would
 * undo the section the user dropped it into, and would drop it out of the
 * optimistic order it was given, so it keeps the section the drop assigned.
 */
export function cohereGroupSections<T>(input: {
  readonly active: readonly T[];
  readonly working: readonly T[];
  readonly groupKeyOf: (thread: T) => string | null;
  readonly needsAttention: (thread: T) => boolean;
  readonly skip?: T | null;
}): { readonly active: readonly T[]; readonly working: readonly T[] } {
  const { active, working, groupKeyOf, needsAttention, skip = null } = input;
  // Without the Working shelf there is only one live section to agree on.
  if (working.length === 0) return { active, working };
  const workingSet = new Set<T>(working);
  const target = new Map<string, "active" | "working">();
  for (const [key, members] of groupThreads([...active, ...working], groupKeyOf)) {
    if (members.length < 2) continue;
    if (members.some((thread) => needsAttention(thread))) target.set(key, "active");
    else if (members.some((thread) => workingSet.has(thread))) target.set(key, "working");
  }
  if (target.size === 0) return { active, working };
  const nextActive: T[] = [];
  const nextWorking: T[] = [];
  const place = (thread: T, current: "active" | "working") => {
    const key = thread === skip ? null : groupKeyOf(thread);
    const to = (key === null ? undefined : target.get(key)) ?? current;
    (to === "working" ? nextWorking : nextActive).push(thread);
  };
  for (const thread of active) place(thread, "active");
  for (const thread of working) place(thread, "working");
  // Both lists are sorted right after this, so the order here is irrelevant.
  return { active: nextActive, working: nextWorking };
}

/**
 * Reorder a sorted section so a group's threads sit together, at the slot its
 * best-placed member already holds. Grouping only ever pulls members up to
 * that slot, so a group rises as soon as any one of its members does, and the
 * arrangement stays a default rather than a sort of its own.
 */
export function clusterThreadsByGroup<T>(
  sorted: readonly T[],
  groupKeyOf: (thread: T) => string | null,
  options: { readonly isPinnedInPlace?: (thread: T) => boolean } = {},
): readonly T[] {
  if (sorted.length < 2) return sorted;
  const { isPinnedInPlace } = options;
  const stays = (thread: T) => isPinnedInPlace?.(thread) === true;
  const byGroup = groupThreads(sorted, groupKeyOf);
  if (byGroup.size === 0) return sorted;
  const clustered: T[] = [];
  const emitted = new Set<T>();
  for (const thread of sorted) {
    if (emitted.has(thread)) continue;
    const key = stays(thread) ? null : groupKeyOf(thread);
    if (key === null) {
      clustered.push(thread);
      emitted.add(thread);
      continue;
    }
    for (const member of byGroup.get(key) ?? []) {
      if (emitted.has(member) || stays(member)) continue;
      clustered.push(member);
      emitted.add(member);
    }
  }
  return clustered;
}

/**
 * Turn sorted sections into rows: a group's row followed by its members, and
 * ungrouped threads on their own. A folded group keeps its row and drops its
 * members, except the one the user has open — the way a collapsed shelf keeps
 * the open thread on screen.
 *
 * Sizes count every live section, so a group reads as the same size wherever
 * its row appears.
 */
export function layoutThreadGroups<T>(input: {
  readonly sections: ReadonlyArray<readonly T[]>;
  readonly groupKeyOf: (thread: T) => string | null;
  readonly nameOf?: (key: string) => string;
  /** A set of folded keys, or the question asked per group. */
  readonly collapsed: ReadonlySet<string> | ((key: string) => boolean);
  readonly keepThread?: (thread: T) => boolean;
}): ReadonlyArray<ReadonlyArray<ThreadGroupEntry<T>>> {
  const { sections, groupKeyOf, nameOf, collapsed, keepThread } = input;
  const isCollapsed =
    typeof collapsed === "function" ? collapsed : (key: string) => collapsed.has(key);
  const grouped = sections.map((section) => groupThreads(section, groupKeyOf));
  const sizes = new Map<string, number>();
  for (const groups of grouped) {
    for (const [key, members] of groups) {
      sizes.set(key, (sizes.get(key) ?? 0) + members.length);
    }
  }
  const groupOf = (key: string): ThreadGroup | null => {
    const size = sizes.get(key) ?? 0;
    // A thread alone on its key is just a thread.
    if (size < 2) return null;
    return { key, name: nameOf?.(key) ?? key, size, collapsed: isCollapsed(key) };
  };
  return sections.map((section) => {
    const entries: ThreadGroupEntry<T>[] = [];
    const opened = new Set<string>();
    for (const thread of section) {
      const key = groupKeyOf(thread);
      const group = key === null ? null : groupOf(key);
      if (group === null) {
        entries.push({ kind: "thread", thread, group: null, isGroupEnd: false });
        continue;
      }
      if (!opened.has(group.key)) {
        opened.add(group.key);
        entries.push({ kind: "group", group });
      }
      if (group.collapsed && keepThread?.(thread) !== true) continue;
      entries.push({ kind: "thread", thread, group, isGroupEnd: false });
    }
    // The rail caps wherever the group stops, not only at its last member: a
    // hand-placed row dropped between two members splits the block in two, and
    // a half with no end draws a rail running into the row below it.
    return entries.map((entry, index) =>
      entry.kind === "thread" &&
      entry.group !== null &&
      !isSameGroupEntry(entries[index + 1], entry.group.key)
        ? { ...entry, isGroupEnd: true }
        : entry,
    );
  });
}

function isSameGroupEntry<T>(entry: ThreadGroupEntry<T> | undefined, key: string): boolean {
  return entry?.kind === "thread" && entry.group?.key === key;
}

/**
 * Fold or unfold a group, keeping only groups that still have a row on screen.
 * Without the prune the list grows for every group ever folded, and a new
 * thread reusing a shipped ticket's id would come back folded.
 */
export function toggleCollapsedGroup(
  collapsed: readonly string[],
  key: string,
  liveKeys: ReadonlySet<string>,
): readonly string[] {
  const next = collapsed.includes(key)
    ? collapsed.filter((entry) => entry !== key)
    : [...collapsed, key];
  return next.filter((entry) => liveKeys.has(entry));
}

/**
 * A group the user composed and named, as opposed to one inferred from titles.
 * Members are whatever key the client identifies a thread by, so this module
 * never needs to know what a thread is.
 */
export interface ManualThreadGroup {
  readonly id: string;
  readonly name: string;
  readonly members: readonly string[];
}

/** Namespaced so a hand-made group can never collide with a ticket id. */
export function manualGroupKey(id: string): string {
  return `m:${id}`;
}

/** How one member of a folded group is doing. */
export type ThreadGroupTone = "done" | "working" | "attention";

/**
 * What a folded group says about its members, in the slot a thread's row keeps
 * for its own state.
 *
 * One line for several threads, so it reports the most demanding state and how
 * many are in it: what is left to do is what makes someone unfold the group,
 * and a count of what is finished never does.
 */
export function groupStateLabel(tones: readonly ThreadGroupTone[]): {
  readonly tone: ThreadGroupTone;
  readonly label: string;
} {
  const attention = tones.filter((tone) => tone === "attention").length;
  if (attention > 0) return { tone: "attention", label: `${attention} to look at` };
  const working = tones.filter((tone) => tone === "working").length;
  if (working > 0) return { tone: "working", label: `${working} working` };
  return { tone: "done", label: "Done" };
}

/**
 * Which group a thread belongs to.
 *
 * Three answers, in the order they are trusted. A hand-made group wins: the
 * thread was put there on purpose, and the ticket in its title is only a guess.
 * Then a thread taken out of its ticket's group stays out — a group read from
 * titles has no member list to remove anyone from, so the removal itself is
 * what has to be remembered. Otherwise the title decides, which is what makes a
 * thread created later join its ticket with nothing to do.
 */
export function resolveGroupKey(input: {
  readonly manualGroups: readonly ManualThreadGroup[];
  readonly ungroupedThreadKeys?: ReadonlySet<string>;
  readonly threadKey: string;
  readonly title: string;
}): string | null {
  const { manualGroups, ungroupedThreadKeys, threadKey, title } = input;
  const manual = manualGroups.find((group) => group.members.includes(threadKey));
  if (manual !== undefined) return manualGroupKey(manual.id);
  if (ungroupedThreadKeys?.has(threadKey) === true) return null;
  return ticketGroupKeyOf(title);
}

/**
 * Keep threads out of the group their titles put them in.
 *
 * Only a title that names a ticket is worth remembering, because only a title
 * can put a thread back: leaving a hand-made group is the whole of leaving it,
 * and an entry for a thread no rule would group is an entry that would silently
 * refuse the grouping if its title gained a ticket later.
 */
export function ungroupedKeysWith(
  ungroupedThreadKeys: readonly string[],
  threads: readonly { readonly key: string; readonly title: string }[],
): readonly string[] {
  const added = threads
    .filter(
      (thread) =>
        ticketGroupKeyOf(thread.title) !== null && !ungroupedThreadKeys.includes(thread.key),
    )
    .map((thread) => thread.key);
  return added.length === 0 ? ungroupedThreadKeys : [...ungroupedThreadKeys, ...added];
}

/** Let threads be grouped by their titles again. */
export function ungroupedKeysWithout(
  ungroupedThreadKeys: readonly string[],
  threadKeys: readonly string[],
): readonly string[] {
  const kept = ungroupedThreadKeys.filter((key) => !threadKeys.includes(key));
  return kept.length === ungroupedThreadKeys.length ? ungroupedThreadKeys : kept;
}

/** Forget threads that no longer exist, keeping the list's identity when none did. */
export function pruneUngroupedKeys(
  ungroupedThreadKeys: readonly string[],
  liveThreadKeys: ReadonlySet<string>,
): readonly string[] {
  const pruned = ungroupedThreadKeys.filter((key) => liveThreadKeys.has(key));
  return pruned.length === ungroupedThreadKeys.length ? ungroupedThreadKeys : pruned;
}

export function manualGroupNameOf(
  manualGroups: readonly ManualThreadGroup[],
  key: string,
): string | null {
  return manualGroups.find((group) => manualGroupKey(group.id) === key)?.name ?? null;
}

/**
 * Put threads in a new group, taking them out of any group they were in.
 * Membership is a set: a group's rows follow the list's own order, so there is
 * no position inside a group to keep.
 */
export function addManualGroup(
  manualGroups: readonly ManualThreadGroup[],
  group: ManualThreadGroup,
): readonly ManualThreadGroup[] {
  return [...removeFromManualGroups(manualGroups, group.members), group];
}

/**
 * Take threads out of their group, and drop a group left with one member:
 * a group of one is a thread, and leaving it would show a container that
 * contains nothing to fold.
 */
export function removeFromManualGroups(
  manualGroups: readonly ManualThreadGroup[],
  threadKeys: readonly string[],
): readonly ManualThreadGroup[] {
  const leaving = new Set(threadKeys);
  return manualGroups
    .map((group) => ({
      ...group,
      members: group.members.filter((member) => !leaving.has(member)),
    }))
    .filter((group) => group.members.length > 1);
}

export function renameManualGroup(
  manualGroups: readonly ManualThreadGroup[],
  key: string,
  name: string,
): readonly ManualThreadGroup[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return manualGroups;
  return manualGroups.map((group) =>
    manualGroupKey(group.id) === key ? { ...group, name: trimmed } : group,
  );
}

export function dropManualGroup(
  manualGroups: readonly ManualThreadGroup[],
  key: string,
): readonly ManualThreadGroup[] {
  return manualGroups.filter((group) => manualGroupKey(group.id) !== key);
}

/**
 * Forget members that no longer exist, and the groups that empties. Threads
 * are deleted and archived elsewhere, and nothing tells this list about it.
 */
export function pruneManualGroups(
  manualGroups: readonly ManualThreadGroup[],
  liveThreadKeys: ReadonlySet<string>,
): readonly ManualThreadGroup[] {
  const pruned = manualGroups
    .map((group) => ({
      ...group,
      members: group.members.filter((member) => liveThreadKeys.has(member)),
    }))
    .filter((group) => group.members.length > 1);
  const unchanged =
    pruned.length === manualGroups.length &&
    pruned.every((group, index) => group.members.length === manualGroups[index]?.members.length);
  return unchanged ? manualGroups : pruned;
}

/** A sensible name to start from: the ticket they share, or nothing special. */
export function suggestGroupName(titles: readonly string[]): string {
  const keys = new Set(titles.map((title) => ticketGroupKeyOf(title)));
  const only = keys.size === 1 ? [...keys][0] : null;
  return only ?? "New group";
}

/**
 * Move a thread into a group it is not in. Leaving its previous group may
 * dissolve that one, which is why the removal runs first.
 */
export function addToManualGroup(
  manualGroups: readonly ManualThreadGroup[],
  key: string,
  threadKey: string,
): readonly ManualThreadGroup[] {
  // Already there: the removal below would take the group to one member and
  // dissolve it, so adding a member it has would delete the group instead.
  const target = manualGroups.find((group) => manualGroupKey(group.id) === key);
  if (target?.members.includes(threadKey) === true) return manualGroups;
  return removeFromManualGroups(manualGroups, [threadKey]).map((group) =>
    manualGroupKey(group.id) === key ? { ...group, members: [...group.members, threadKey] } : group,
  );
}

export interface GroupDropPlan {
  readonly manualGroups: readonly ManualThreadGroup[];
  /** The group to open for renaming, when the drop invented one. */
  readonly renameKey: string | null;
}

/**
 * What dropping a thread onto a row means. Onto a thread with no group, the
 * two become a group you name. Onto anything already in a group, the thread
 * joins it — and a group that was only inferred from titles becomes yours in
 * the process, because you just put something in it on purpose.
 */
export function planGroupDrop(input: {
  readonly manualGroups: readonly ManualThreadGroup[];
  readonly draggedKey: string;
  /** The group the drop landed on or in, if any. */
  readonly targetGroupKey: string | null;
  /** Members of that group, needed only when it is an inferred one. */
  readonly targetGroupMembers: readonly string[];
  /** The row's thread, or null when the drop landed on a group's own row. */
  readonly targetThreadKey: string | null;
  readonly newGroupId: string;
  readonly newGroupName: string;
}): GroupDropPlan | null {
  const {
    manualGroups,
    draggedKey,
    targetGroupKey,
    targetGroupMembers,
    targetThreadKey,
    newGroupId,
    newGroupName,
  } = input;
  if (targetThreadKey === draggedKey) return null;
  if (targetGroupKey !== null) {
    const manual = manualGroups.find((group) => manualGroupKey(group.id) === targetGroupKey);
    if (manual !== undefined) {
      if (manual.members.includes(draggedKey)) return null;
      return {
        manualGroups: addToManualGroup(manualGroups, targetGroupKey, draggedKey),
        renameKey: null,
      };
    }
    // Inferred until now; reaching into it makes it a group of your own, under
    // the name it already had.
    const members = [...targetGroupMembers.filter((member) => member !== draggedKey), draggedKey];
    if (members.length < 2) return null;
    return {
      manualGroups: addManualGroup(manualGroups, {
        id: newGroupId,
        name: targetGroupKey,
        members,
      }),
      renameKey: null,
    };
  }
  if (targetThreadKey === null) return null;
  return {
    manualGroups: addManualGroup(manualGroups, {
      id: newGroupId,
      name: newGroupName,
      members: [targetThreadKey, draggedKey],
    }),
    renameKey: manualGroupKey(newGroupId),
  };
}
