/**
 * Reading `git log --format="%h %s"` as something worth reading.
 *
 * The list the updater carries is a few hundred subjects, and upstream writes
 * conventional commits — so the prefix already says which of them answer "what
 * do I get by restarting". Nothing is fetched to work this out: the grouping is
 * the same strings, sorted.
 */

export interface ForkChange {
  readonly sha: string;
  readonly type: string;
  readonly scope: string | null;
  readonly title: string;
  readonly pull: number | null;
}

export interface ForkChangeGroup {
  readonly key: string;
  readonly label: string;
  /** Tailwind background for the group's dot, and whether it opens folded out. */
  readonly dot: string;
  readonly open: boolean;
  readonly changes: readonly ForkChange[];
}

/** `<sha> <type>(<scope>)!: <subject> (#<pull>)`, every part after the sha optional. */
const SUBJECT = /^([0-9a-f]{7,40})\s+(?:(\w+)(?:\(([^)]*)\))?!?:\s*)?(.*)$/i;
const PULL = /\s*\(#(\d+)\)$/;

export function parseForkChange(line: string): ForkChange | null {
  const match = SUBJECT.exec(line.trim());
  if (!match) return null;
  const [, sha, type, scope, rest] = match;
  const pull = PULL.exec(rest ?? "");
  return {
    sha: sha ?? "",
    // A revert of a conventional commit quotes it, so `revert: "fix(web): …"`
    // reads as type `revert` with the original subject behind it. That is the
    // right group: what matters is that it was taken back.
    type: (type ?? "").toLowerCase(),
    scope: scope?.trim() || null,
    title: (pull ? (rest ?? "").slice(0, pull.index) : (rest ?? "")).trim(),
    pull: pull?.[1] ? Number(pull[1]) : null,
  };
}

/**
 * The groups, in reading order, with everything the UI needs to draw them.
 *
 * One table rather than a key list here and a colour map in the component: a
 * group added to only one of them renders unlabelled or undotted, and a
 * `Record<string, string>` lookup makes that a silent `undefined` rather than a
 * type error.
 */
const GROUPS = [
  { key: "feature", label: "New", dot: "bg-success", open: true, types: ["feat"] },
  { key: "fix", label: "Fixes", dot: "bg-info", open: true, types: ["fix"] },
  { key: "revert", label: "Reverts", dot: "bg-warning", open: false, types: ["revert"] },
  // Everything else, named for what it is mostly made of rather than left as
  // "other": the point of the group is that you can tell it is skippable.
  { key: "internal", label: "Tests, CI and internals", dot: "bg-muted-foreground", open: false },
] as const satisfies readonly {
  key: string;
  label: string;
  dot: string;
  open: boolean;
  types?: readonly string[];
}[];

const CATCH_ALL = "internal";
/** Built once: the catch-all is "no entry here", not a group claiming no types. */
const GROUP_OF_TYPE = new Map<string, string>(
  GROUPS.flatMap((group) =>
    ("types" in group ? group.types : []).map((type): [string, string] => [type, group.key]),
  ),
);

/** The changes grouped for reading, in reading order, empty groups dropped. */
export function groupForkChanges(lines: readonly string[]): readonly ForkChangeGroup[] {
  const buckets = new Map<string, ForkChange[]>();
  for (const line of lines) {
    const change = parseForkChange(line);
    if (!change) continue;
    const key = GROUP_OF_TYPE.get(change.type) ?? CATCH_ALL;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(change);
    else buckets.set(key, [change]);
  }
  return GROUPS.flatMap((group) => {
    const changes = buckets.get(group.key);
    return changes ? [{ ...group, types: undefined, changes }] : [];
  });
}
