import { type EnvironmentId, type ScopedProjectRef } from "@t3tools/contracts";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { ThreadContextDragGhost } from "./chat/ThreadContextDragGhost";
import {
  dropThreadContext,
  endThreadContextDrag,
  moveThreadContextDrag as moveThreadContextDragGhost,
} from "./chat/threadContextDrag";
import { discardComposerDraft } from "../lib/discardComposerDraft";
import { requestCustomSnooze } from "./CustomSnoozeDialog";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import {
  DndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type CollisionDetection,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import { createInboxReturnTracker } from "@t3tools/client-runtime/state/thread-inbox";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";

import { FolderIcon, ListFilterIcon, PlusIcon, SettingsIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform, randomUUID } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import { selectProjectGroupingSettings } from "../logicalProject";
import {
  projectGroupsSpanEnvironments,
  resolveSidebarProjectScopeKey,
  getSidebarProjectSettingsKey,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { useUiStateStore } from "../uiStateStore";
import {
  getThreadKeysToDeselectAfterDelete,
  useThreadSelectionStore,
} from "../threadSelectionStore";
import { useAcknowledgeThreadWoke, useThreadActions } from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSidebarProjectGroups } from "../hooks/useSidebarProjectGroups";
import { useTerminalFocus } from "../hooks/useTerminalFocus";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { registerSettleAndAdvance } from "../settleAndAdvance";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNowMinute } from "../hooks/useNowMinute";
import {
  useEnvironmentIdentities,
  useConnectedEnvironmentIds,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "../state/environments";
import {
  readThreadShell,
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useServerConfigs,
  useQuietThreadShells,
} from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentProjects } from "../state/projects";
import { threadEnvironment } from "../state/threads";
import { useThreadSearch } from "../state/queries";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { readEnvironmentScope } from "../state/session";
import { buildThreadRouteParams, resolveActiveThreadRouteRef } from "../threadRoutes";
import type { SidebarThreadSummary } from "../types";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { cn } from "~/lib/utils";
import { ProjectEnvironmentBadge } from "./ProjectEnvironmentBadge";
import {
  buildDraftActionMenuItems,
  buildThreadActionMenuItems,
  threadActionRequiresOperate,
} from "./threadActionMenu.logic";
import {
  applySidebarThreadDrop,
  filterSidebarV2VisibleThreads,
  buildBulkTitleRegenerationContextMenuItem,
  buildBulkUnpinContextMenuItem,
  deleteSelectedThreadEntries,
  filterSidebarProjectScopeItems,
  firstValidTimestampMs,
  isGroupJoinHover,
  isSidebarNestedLinkClick,
  isSidebarThreadWorking,
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  planSidebarThreadDrop,
  sidebarGroupItemId,
  sidebarGroupKeyFromItemId,
  reduceSidebarProjectScopeMenuState,
  resolveAdjacentThreadId,
  resolveSidebarSweepKeys,
  groupKeyAtSidebarSlot,
  sidebarMarkerId,
  sidebarSectionAtSlot,
  resolveSidebarDropTarget,
  planSidebarGroupMove,
  resolveSidebarDropVerb,
  resolveSidebarThreadSection,
  resolveSidebarThreadStatus,
  searchSidebarThreads,
  shouldCreateNewThreadInCurrentProject,
  shouldNavigateAfterThreadPark,
  sidebarListItemId,
  sidebarThreadKeyAtY,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortThreadsForSidebar,
  sortWorkingThreadsBySend,
  useThreadJumpHintVisibility,
  type SidebarListItem,
  type SidebarSection,
  resolveSidebarRowThreadId,
} from "./Sidebar.logic";
import { planPinnedReorder } from "@t3tools/client-runtime/state/thread-sort";
import {
  clusterThreadsByGroup,
  cohereGroupSections,
  layoutThreadGroups,
  addManualGroup,
  dropManualGroup,
  manualGroupKey,
  manualGroupNameOf,
  planGroupDrop,
  pruneManualGroups,
  pruneUngroupedKeys,
  removeFromManualGroups,
  renameManualGroup,
  suggestGroupName,
  resolveGroupKey,
  toggleCollapsedGroup,
  ungroupedKeysWith,
  ungroupedKeysWithout,
  type ManualThreadGroup,
  type ThreadGroup,
  type ThreadGroupEntry,
} from "@t3tools/client-runtime/state/thread-groups";
import { createSidebarCollisionDetection, sidebarRowsStayPut } from "./Sidebar.drag";
import { SidebarDragLifecycle, SidebarPointerSensor } from "./Sidebar.pointer";
import { createSidebarListMotion } from "./Sidebar.motion";
import { resolveSnoozePresets, snoozeWakeLabel, type SnoozePreset } from "./Sidebar.snooze";
import { ProjectFavicon } from "./ProjectFavicon";
import { deriveProviderEntriesByEnvironment } from "../providerInstances";
import { useStableCallback } from "../hooks/useStableCallback";
import {
  completeSidebarRouteReveal,
  pendingSidebarRouteReveal,
  type SidebarRouteReveal,
} from "./sidebar/routeReveal";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
  useComboboxFilter,
} from "./ui/combobox";
import { SidebarContent, SidebarGroup, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { SidebarHeaderIconButton, SidebarThreadHeader } from "./sidebar/SidebarThreadHeader";
import { TooltipProvider } from "./ui/tooltip";
import { composerDraftHasUserContent, DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import {
  SidebarSearchResultRow,
  SortableThreadRow,
  type SidebarProviderEntry,
  type SidebarSweepAction,
} from "./sidebar/SidebarThreadRow";
import { SidebarDraftBlock } from "./sidebar/SidebarDraftBlock";
import {
  SidebarDragBoundary,
  SidebarGroupHeader,
  SidebarSectionHeader,
  type SidebarGroupMember,
  SidebarDropZone,
  SidebarSectionPlaceholder,
} from "./sidebar/SidebarListMarkers";

function sameSidebarProviderEntries(
  left: ReadonlyMap<string, SidebarProviderEntry>,
  right: ReadonlyMap<string, SidebarProviderEntry>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [instanceId, entry] of right) {
    const other = left.get(instanceId);
    if (
      other === undefined ||
      other.driverKind !== entry.driverKind ||
      other.enabled !== entry.enabled ||
      other.displayName !== entry.displayName ||
      other.accentColor !== entry.accentColor ||
      other.acpRegistryAgentId !== entry.acpRegistryAgentId ||
      other.acpRegistryIconUrl !== entry.acpRegistryIconUrl ||
      other.models !== entry.models
    ) {
      return false;
    }
  }
  return true;
}

// Threads on non-primary environments (T3 Connect, hosted) resolve their
// provider entry from their own environment's config: default instance ids
// are driver slugs, so a flat map would collide across environments.
const sidebarProviderEntriesAtom = Atom.make((get) => {
  const providersByEnvironment = get(environmentPresentations.providersByEnvironmentAtom);
  const derived = deriveProviderEntriesByEnvironment(
    [...get(environmentPresentations.serverConfigsAtom)].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );
  const previous = Option.getOrNull(
    get.self<ReadonlyMap<string, ReadonlyMap<string, SidebarProviderEntry>>>(),
  );
  const next = new Map<string, ReadonlyMap<string, SidebarProviderEntry>>();
  let changed = previous === null || previous.size !== derived.size;
  for (const [environmentId, entries] of derived) {
    const prior = previous?.get(environmentId);
    if (prior !== undefined && sameSidebarProviderEntries(prior, entries)) {
      next.set(environmentId, prior);
    } else {
      next.set(environmentId, entries);
      changed = true;
    }
  }
  return !changed && previous !== null ? previous : next;
}).pipe(Atom.withLabel("sidebar-provider-entries"));

const EMPTY_PROVIDER_ENTRIES: ReadonlyMap<string, SidebarProviderEntry> = new Map();
// Collapsed shelves share one empty list so a route change alone does not
// give the sidebar list a new identity.
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];

const SETTLED_TAIL_INITIAL_COUNT = 10;
const SETTLED_TAIL_PAGE_COUNT = 25;
const SETTLED_SHELF_EXPANDED_KEY = "t3code:sidebar:settled-expanded";
const SNOOZED_SHELF_EXPANDED_KEY = "t3code:sidebar:snoozed-expanded";
const WORKING_SHELF_EXPANDED_KEY = "t3code:sidebar:working-expanded";
const COLLAPSED_GROUPS_KEY = "t3code:sidebar:collapsed-groups:v1";
const MANUAL_GROUPS_KEY = "t3code:sidebar:thread-groups:v1";
const MANUAL_GROUPS_SCHEMA = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    members: Schema.Array(Schema.String),
  }),
);
const NO_MANUAL_GROUPS: readonly ManualThreadGroup[] = [];
// Threads taken out of the group their title put them in. Stored apart from the
// groups themselves because what it holds is the absence of a membership: the
// group it refers to has no member list to be missing from.
const UNGROUPED_THREADS_KEY = "t3code:sidebar:ungrouped-threads:v1";
const UNGROUPED_THREADS_SCHEMA = Schema.Array(Schema.String);
const NO_UNGROUPED_THREADS: readonly string[] = [];
const COLLAPSED_GROUPS_SCHEMA = Schema.Array(Schema.String);
/** Stable default, so an unfolded sidebar does not re-render on identity. */
const NO_COLLAPSED_GROUPS: readonly string[] = [];
/**
 * Where a row is now.
 *
 * dnd-kit measures its rows once, when the drag starts, and the gap a drop
 * zone opens moves every row below it — so by the second move those rects
 * answer for a list that is no longer on screen.
 */
function sidebarRow(list: HTMLElement | null, id: string): HTMLElement | null {
  return list?.querySelector<HTMLElement>(`[data-drag-id="${CSS.escape(id)}"]`) ?? null;
}

function sidebarRowRect(list: HTMLElement | null, id: string): DOMRect | null {
  return sidebarRow(list, id)?.getBoundingClientRect() ?? null;
}

/**
 * Where a row's slot sits, with no transform in the answer.
 *
 * A rect would carry the transform already on the card, and a transform
 * computed from it chases its own tail. `offsetTop` is layout alone, and the
 * list's own rect turns it back into a viewport position.
 */
function sidebarSlotOrigin(node: HTMLElement): { x: number; y: number } | null {
  const parent = node.offsetParent;
  if (parent === null) return null;
  const parentRect = parent.getBoundingClientRect();
  return { x: parentRect.left + node.offsetLeft, y: parentRect.top + node.offsetTop };
}

type SidebarDropSlot = { readonly id: string; readonly side: "above" | "below" };

/**
 * Which shelf a row sits on, for the maps a group's row is read from. Active
 * and Working are one shelf: they are laid out together, and a group only ever
 * has a row in one of them.
 */
function groupShelfKey(groupKey: string, section: SidebarSection): string {
  const shelf = section === "pinned" || section === "settled" ? section : "live";
  return `${shelf}:${groupKey}`;
}

const SIDEBAR_AUTO_SCROLL = { threshold: { x: 0, y: 0.2 } };

const EMPTY_GROUP_MEMBERS: readonly SidebarGroupMember[] = [];

const inboxReturns = createInboxReturnTracker();

type SidebarOptimisticDrop = {
  readonly key: string;
  readonly sourceSection: SidebarSection;
  readonly section: "pinned" | "active" | "settled";
  readonly occurredAt: string;
  readonly clearsSnooze: boolean;
  readonly order: readonly string[] | null;
  readonly keysAtDrop: ReadonlyMap<string, string | null>;
  readonly assignedKeys: ReadonlyMap<string, string>;
};

interface SidebarThreadPartitionInput {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly workingShelfEnabled: boolean;
  // Which group a thread belongs to, hand-made groups included, so a group
  // the user composed cohereres and clusters exactly like a ticket's.
  readonly groupKeyOf: (thread: EnvironmentThreadShell) => string | null;
  // Snooze wakes and the queued-turn grace depend on the clock, so the minute
  // tick and the precise snooze-wake tick are inputs: a new key repartitions.
  readonly clockKey: string;
}

function threadShellKey(thread: Pick<SidebarThreadSummary, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function routeThreadOnly(
  threads: readonly EnvironmentThreadShell[],
  routeThreadKey: string | null,
): readonly EnvironmentThreadShell[] {
  if (routeThreadKey === null) return EMPTY_THREADS;
  const routeThread = threads.find((thread) => threadShellKey(thread) === routeThreadKey);
  return routeThread === undefined ? EMPTY_THREADS : [routeThread];
}

// Everything Sidebar derives from thread shells. Computed inside one hook so
// each value reaches the component frozen and cached on its real inputs: in
// the component body, later hook calls made the compiler treat these maps as
// possibly mutated and recompute them, and every dnd-kit input with them.
function useSidebarThreads(input: {
  readonly projectScopeKey: string | null;
  readonly scopedProjectKeys: ReadonlySet<string> | null;
  readonly serverConfigs: ReadonlyMap<EnvironmentId, EnvironmentServerConfig>;
  readonly optimisticDrop: SidebarOptimisticDrop | null;
  readonly routeThreadRef: ScopedThreadRef | null;
}) {
  const { projectScopeKey, scopedProjectKeys, serverConfigs, optimisticDrop, routeThreadRef } =
    input;
  const threads = useQuietThreadShells();
  const routeRowThreadKey =
    routeThreadRef === null
      ? null
      : scopedThreadKey(
          scopeThreadRef(
            routeThreadRef.environmentId,
            resolveSidebarRowThreadId(
              routeThreadRef.threadId,
              routeThreadRef.environmentId,
              threads,
            ),
          ),
        );
  const workingShelfEnabled = useClientSettings((s) => s.sidebarWorkingShelfEnabled);
  const nowMinute = useNowMinute();
  // Snooze wake times are second-precise, so classifying with the quantized
  // minute would hold a woken thread on the shelf for up to a minute.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);
  const [nextSnoozeWakeAt, setNextSnoozeWakeAt] = useState<string | null>(null);
  useEffect(
    () => scheduleSnoozeWake(nextSnoozeWakeAt, () => bumpSnoozeWakeTick((tick) => tick + 1)),
    [nextSnoozeWakeAt],
  );
  const [settledShelfExpanded, setSettledShelfExpanded] = useLocalStorage(
    SETTLED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useLocalStorage(
    SNOOZED_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [workingShelfExpanded, setWorkingShelfExpanded] = useLocalStorage(
    WORKING_SHELF_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  // The settled tail restarts whenever the project scope changes.
  const [settledTail, setSettledTail] = useState({
    scopeKey: projectScopeKey,
    count: SETTLED_TAIL_INITIAL_COUNT,
  });
  if (settledTail.scopeKey !== projectScopeKey) {
    setSettledTail({ scopeKey: projectScopeKey, count: SETTLED_TAIL_INITIAL_COUNT });
  }
  const settledVisibleCount =
    settledTail.scopeKey === projectScopeKey ? settledTail.count : SETTLED_TAIL_INITIAL_COUNT;

  const [storedManualGroups, setManualGroups] = useLocalStorage(
    MANUAL_GROUPS_KEY,
    NO_MANUAL_GROUPS,
    MANUAL_GROUPS_SCHEMA,
  );
  const [storedUngroupedThreads, setUngroupedThreads] = useLocalStorage(
    UNGROUPED_THREADS_KEY,
    NO_UNGROUPED_THREADS,
    UNGROUPED_THREADS_SCHEMA,
  );
  // A thread deleted or archived elsewhere leaves its key behind; drop it, and
  // the group it empties, before anything reads membership.
  const liveThreadKeys = new Set(threads.map(threadShellKey));
  const manualGroups = pruneManualGroups(storedManualGroups, liveThreadKeys);
  const ungroupedThreads = pruneUngroupedKeys(storedUngroupedThreads, liveThreadKeys);
  const ungroupedThreadKeys = new Set(ungroupedThreads);
  const groupKeyOf = (thread: EnvironmentThreadShell) =>
    resolveGroupKey({
      manualGroups,
      ungroupedThreadKeys,
      threadKey: threadShellKey(thread),
      title: thread.title,
    });
  const groupNameOf = (key: string) => manualGroupNameOf(manualGroups, key) ?? key;
  const partition = partitionSidebarThreads({
    threads,
    scopedProjectKeys,
    serverConfigs,
    optimisticDrop,
    workingShelfEnabled,
    groupKeyOf,
    clockKey: `${nowMinute}:${snoozeWakeTick}`,
  });
  const partitionNextWakeAt = partition.snoozedThreads[0]?.snoozedUntil ?? null;
  if (partitionNextWakeAt !== nextSnoozeWakeAt) setNextSnoozeWakeAt(partitionNextWakeAt);

  const { pinnedThreads, activeThreads, workingThreads, snoozedThreads, settledThreads } =
    partition;
  const visibleSettledThreads = (() => {
    if (settledThreads.length <= settledVisibleCount) return settledThreads;
    const visible = settledThreads.slice(0, settledVisibleCount);
    if (routeRowThreadKey !== null) {
      const routeThread = settledThreads
        .slice(settledVisibleCount)
        .find((thread) => threadShellKey(thread) === routeRowThreadKey);
      if (routeThread !== undefined) visible.push(routeThread);
    }
    return visible;
  })();
  const renderedSettledRows = settledShelfExpanded
    ? visibleSettledThreads
    : routeThreadOnly(visibleSettledThreads, routeRowThreadKey);
  const visibleSnoozedThreads = snoozedShelfExpanded
    ? snoozedThreads
    : routeThreadOnly(snoozedThreads, routeRowThreadKey);
  const visibleWorkingThreads = workingShelfExpanded
    ? workingThreads
    : routeThreadOnly(workingThreads, routeRowThreadKey);
  // Folding is per group, not per section, so a group stays folded as its
  // threads move between Active and Working.
  const [collapsedGroups, setCollapsedGroups] = useLocalStorage(
    COLLAPSED_GROUPS_KEY,
    NO_COLLAPSED_GROUPS,
    COLLAPSED_GROUPS_SCHEMA,
  );
  const layoutOf = (
    sections: readonly (readonly EnvironmentThreadShell[])[],
    collapsed: ReadonlySet<string> | ((key: string) => boolean),
  ) =>
    layoutThreadGroups({
      sections,
      groupKeyOf,
      nameOf: groupNameOf,
      collapsed,
      // Kept as an entry, not as a row: a fold takes the open thread with the
      // rest of its group — its row would repeat the title the group's own row
      // already carries — but traversal still has to have somewhere to start.
      keepThread: (thread) => threadShellKey(thread) === routeRowThreadKey,
    });
  // A shelf holds what has been put away, so a group keeps to one row there
  // until it is opened on that shelf: `collapsedGroups` names the inbox's
  // folds, and a shelf's entries name its unfolds instead.
  const shelfFold = (section: "pinned" | "settled" | "snoozed") => (key: string) =>
    !collapsedGroups.includes(`${section}:${key}`);
  // One pass per shelf, so a group's row only appears where two of its threads
  // actually are: a lone member of a ticket is just a thread.
  const [activeEntries = [], workingEntries = []] = layoutOf(
    [activeThreads, visibleWorkingThreads],
    new Set(collapsedGroups),
  );
  const [pinnedEntries = []] = layoutOf([pinnedThreads], shelfFold("pinned"));
  const [settledEntries = []] = layoutOf([renderedSettledRows], shelfFold("settled"));
  const [snoozedEntries = []] = layoutOf([visibleSnoozedThreads], shelfFold("snoozed"));
  const threadsOf = (entries: readonly ThreadGroupEntry<EnvironmentThreadShell>[]) =>
    entries.flatMap((entry) => (entry.kind === "thread" ? [entry.thread] : []));
  const renderedActiveThreads = threadsOf(activeEntries);
  const renderedWorkingThreads = threadsOf(workingEntries);
  const renderedPinnedThreads = threadsOf(pinnedEntries);
  const renderedSettledThreads = threadsOf(settledEntries);
  const renderedSnoozedThreads = threadsOf(snoozedEntries);
  // Both names a fold can go under: the inbox folds by group, a shelf unfolds
  // by group *and* shelf, and the prune must keep whichever is on screen.
  const liveGroupKeys = new Set([
    ...[...activeEntries, ...workingEntries].flatMap((entry) =>
      entry.kind === "group" ? [entry.group.key] : [],
    ),
    ...pinnedEntries.flatMap((entry) =>
      entry.kind === "group" ? [`pinned:${entry.group.key}`] : [],
    ),
    ...settledEntries.flatMap((entry) =>
      entry.kind === "group" ? [`settled:${entry.group.key}`] : [],
    ),
    ...snoozedEntries.flatMap((entry) =>
      entry.kind === "group" ? [`snoozed:${entry.group.key}`] : [],
    ),
  ]);
  // Rows a fold hides are off screen, so they stay out of the ordered list the
  // same way a collapsed shelf's rows do: range selection, action sweeps, jump
  // hints and thread traversal must not reach a row the user cannot see.
  // What a fold may still refer to, which is not what has a row: a project
  // filter leaves a group's threads in place while taking its row off screen,
  // and pruning against the rows would forget that group's fold the next time
  // any other one is folded.
  const foldableGroupKeys = new Set(
    threads.flatMap((thread) => {
      const key = groupKeyOf(thread);
      return key === null ? [] : [key, `pinned:${key}`, `settled:${key}`, `snoozed:${key}`];
    }),
  );
  const orderedThreads = [
    ...renderedPinnedThreads,
    ...renderedActiveThreads,
    ...renderedWorkingThreads,
    ...renderedSnoozedThreads,
    ...renderedSettledThreads,
  ];
  const sectionByThreadKey = new Map<string, SidebarSection>();
  for (const [list, section] of [
    [pinnedThreads, "pinned"],
    [activeThreads, "active"],
    [workingThreads, "working"],
    [snoozedThreads, "snoozed"],
    [settledThreads, "settled"],
  ] as const) {
    for (const thread of list) sectionByThreadKey.set(threadShellKey(thread), section);
  }
  return {
    routeRowThreadKey,
    ...partition,
    threads,
    workingShelfEnabled,
    searchableThreads: [
      ...pinnedThreads,
      ...activeThreads,
      ...workingThreads,
      ...snoozedThreads,
      ...settledThreads,
    ],
    hiddenSettledCount: settledThreads.length - visibleSettledThreads.length,
    showMoreSettled: () =>
      setSettledTail((current) => ({
        scopeKey: current.scopeKey,
        count: current.count + SETTLED_TAIL_PAGE_COUNT,
      })),
    settledShelfExpanded,
    toggleSettledShelf: () => setSettledShelfExpanded((value) => !value),
    snoozedShelfExpanded,
    toggleSnoozedShelf: () => setSnoozedShelfExpanded((value) => !value),
    workingShelfExpanded,
    toggleWorkingShelf: () => setWorkingShelfExpanded((value) => !value),
    renderedSettledThreads,
    visibleWorkingThreads,
    pinnedEntries,
    activeEntries,
    workingEntries,
    settledEntries,
    snoozedEntries,
    manualGroups,
    setManualGroups,
    setUngroupedThreads,
    groupKeyOf,
    // Every live thread a group holds, which a folded group's rows cannot
    // answer: a group read from titles keeps no membership of its own, and the
    // rows that would stand for it are the ones folding hides.
    membersOfGroup: (groupKey: string) =>
      threads
        .filter((thread) => groupKeyOf(thread) === groupKey)
        .map((thread) => ({ key: threadShellKey(thread), title: thread.title })),
    liveGroupKeys,
    renderedActiveThreads,
    renderedWorkingThreads,
    toggleGroup: (groupKey: string) =>
      setCollapsedGroups((current) => toggleCollapsedGroup(current, groupKey, foldableGroupKeys)),
    orderedThreadKeys: orderedThreads.map(threadShellKey),
    threadByKey: new Map(orderedThreads.map((thread) => [threadShellKey(thread), thread] as const)),
    // Ordering reaches rows the screen does not: a folded group's members hold
    // their place in the inbox, so a drop has to be able to write their keys.
    threadByAnyKey: new Map(
      [
        ...pinnedThreads,
        ...activeThreads,
        ...workingThreads,
        ...snoozedThreads,
        ...settledThreads,
      ].map((thread) => [threadShellKey(thread), thread] as const),
    ),
    settledThreadKeys: new Set(settledThreads.map(threadShellKey)),
    snoozedThreadKeys: new Set(snoozedThreads.map(threadShellKey)),
    sectionByThreadKey,
    pinnedKeys: pinnedThreads.map(threadShellKey),
    activeKeys: activeThreads.map(threadShellKey),
    pinnedKeysById: new Map(
      threads.map((thread) => [threadShellKey(thread), thread.pinOrderKey ?? null] as const),
    ),
    activeKeysById: new Map(
      threads.map((thread) => [threadShellKey(thread), thread.activeOrderKey ?? null] as const),
    ),
  };
}

/** A status that is a request to the user rather than progress. */
function threadWantsAnAnswer(thread: EnvironmentThreadShell): boolean {
  const status = resolveSidebarThreadStatus(thread);
  return status === "approval" || status === "input" || status === "failed" || status === "limited";
}

function partitionSidebarThreads(input: SidebarThreadPartitionInput) {
  const { threads, scopedProjectKeys, serverConfigs, optimisticDrop, workingShelfEnabled } = input;
  const groupKeyOf = input.groupKeyOf;
  const preciseNow = new Date().toISOString();
  const visible = filterSidebarV2VisibleThreads(threads, scopedProjectKeys);
  inboxReturns.observe(workingShelfEnabled ? threads : null);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  const inbox = (thread: EnvironmentThreadShell) =>
    workingShelfEnabled && isSidebarThreadWorking(thread) ? working : active;
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  const draggable = new Set<string>();
  const activeReorderable = new Set<string>();
  // The thread an optimistic drop just placed; ticket cohesion leaves it where
  // the drop put it rather than relocating it out from under the user.
  let droppedThread: EnvironmentThreadShell | null = null;
  for (const thread of visible) {
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const supportsSettlement = capabilities?.threadSettlement === true;
    const supportsSnooze = capabilities?.threadSnooze === true;
    const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (capabilities?.threadActiveReorder === true) activeReorderable.add(threadKey);
    if (capabilities?.threadPinning === true && capabilities.threadPinReorder === true) {
      draggable.add(threadKey);
    }
    if (optimisticDrop?.key === threadKey) {
      const projected = applySidebarThreadDrop(
        thread,
        optimisticDrop.section,
        optimisticDrop.occurredAt,
        optimisticDrop.assignedKeys.get(threadKey),
      );
      const dropped = optimisticDrop.clearsSnooze
        ? projected
        : { ...projected, snoozedAt: thread.snoozedAt, snoozedUntil: thread.snoozedUntil };
      droppedThread = dropped;
      (optimisticDrop.section === "pinned"
        ? pinned
        : optimisticDrop.section === "settled"
          ? settled
          : inbox(dropped)
      ).push(dropped);
    } else {
      const section = resolveSidebarThreadSection({
        snoozed: supportsSnooze && effectiveSnoozed(thread, { now: preciseNow }),
        settled: supportsSettlement && thread.settledOverride === "settled",
        pinned: thread.pinnedAt != null,
      });
      (section === "snoozed"
        ? snoozed
        : section === "settled"
          ? settled
          : section === "pinned"
            ? pinned
            : inbox(thread)
      ).push(thread);
    }
  }
  // Server capability only gates DRAGGING — it must not influence the
  // sort, or mixed-version fleets would render different pinned orders on
  // web and mobile from the same data.
  const sortedPinned = sortPinnedThreadsForSidebar(pinned);
  // A ticket delivered across repos is one piece of work: its threads share a
  // live section and sit together. Of the two active sorts, only
  // sortActiveThreadsByOrderKey (the no-shelf branch below) honors
  // `activeOrderKey`, so that is the only one with a hand-placed row for
  // clustering to stay out of.
  const live = cohereGroupSections({
    active,
    working,
    groupKeyOf,
    needsAttention: threadWantsAnAnswer,
    skip: droppedThread,
  });
  const sortedActive = clusterThreadsByGroup(
    workingShelfEnabled
      ? sortInboxThreadsByReturn(live.active, inboxReturns.returnedAt)
      : sortThreadsForSidebar(live.active),
    groupKeyOf,
    workingShelfEnabled
      ? {}
      : { isPinnedInPlace: (thread: EnvironmentThreadShell) => thread.activeOrderKey != null },
  );
  return {
    pinnedThreads:
      optimisticDrop?.section !== "pinned" || optimisticDrop.order === null
        ? sortedPinned
        : orderItemsByPreferredIds({
            items: sortedPinned,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    draggableThreadKeys: draggable,
    activeReorderableThreadKeys: activeReorderable,
    activeThreads:
      optimisticDrop?.section !== "active" || optimisticDrop.order === null
        ? sortedActive
        : orderItemsByPreferredIds({
            items: sortedActive,
            preferredIds: optimisticDrop.order,
            getId: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          }),
    workingThreads: clusterThreadsByGroup(sortWorkingThreadsBySend(live.working), groupKeyOf),
    snoozedThreads: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    settledThreads: sortSettledThreads(settled),
    snoozeNow: preciseNow,
  };
}

function isOptimisticDropReleased(input: {
  readonly optimisticDrop: SidebarOptimisticDrop;
  readonly threads: readonly EnvironmentThreadShell[];
  readonly pinnedKeys: readonly string[];
  readonly activeKeys: readonly string[];
  readonly now: string;
}): boolean {
  const { optimisticDrop, threads, pinnedKeys, activeKeys, now } = input;
  const canonicalByKey = new Map(
    threads.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      thread,
    ]),
  );
  const thread = canonicalByKey.get(optimisticDrop.key);
  if (thread === undefined || thread.archivedAt !== null) {
    return true;
  }
  const canonicalSection = effectiveSnoozed(thread, { now })
    ? "snoozed"
    : thread.settledOverride === "settled"
      ? "settled"
      : thread.pinnedAt != null
        ? "pinned"
        : "active";
  if (
    canonicalSection !== optimisticDrop.sourceSection &&
    canonicalSection !== optimisticDrop.section
  ) {
    return true;
  }
  if (optimisticDrop.order === null) {
    // Settle also emits unpin/unsnooze events. Wait for the entire move
    // before releasing the projected fields and sort timestamps.
    if (
      canonicalSection === optimisticDrop.section &&
      thread.pinnedAt == null &&
      (!optimisticDrop.clearsSnooze || thread.snoozedUntil == null)
    ) {
      return true;
    }
    return false;
  }
  if (canonicalSection !== optimisticDrop.section) return false;
  if (optimisticDrop.clearsSnooze && thread.snoozedUntil != null) return false;
  const destinationKeys = optimisticDrop.section === "pinned" ? pinnedKeys : activeKeys;
  const canonicalDestination = destinationKeys.flatMap((key) => {
    const canonical = canonicalByKey.get(key);
    return canonical === undefined ? [] : [canonical];
  });
  const keyByThread = new Map(
    canonicalDestination.map((thread) => [
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      (optimisticDrop.section === "pinned" ? thread.pinOrderKey : thread.activeOrderKey) ?? null,
    ]),
  );
  const heldOrder = optimisticDrop.order;
  const heldKeys = new Set(heldOrder);
  const membershipChanged =
    destinationKeys.length !== heldOrder.length ||
    destinationKeys.some((key) => !heldKeys.has(key));
  const foreignKeyLanded = destinationKeys.some((threadKey) => {
    const currentKey = keyByThread.get(threadKey) ?? null;
    if (currentKey === (optimisticDrop.keysAtDrop.get(threadKey) ?? null)) return false;
    return currentKey !== optimisticDrop.assignedKeys.get(threadKey);
  });
  const allAssignmentsLanded = [...optimisticDrop.assignedKeys].every(
    ([threadKey, orderKey]) => keyByThread.get(threadKey) === orderKey,
  );
  return membershipChanged || foreignKeyLanded || allAssignmentsLanded;
}

// Sidebar() is large enough that the compiler cannot prove its local maps stay
// unmutated; built inside a hook they reach it frozen and cached.
function useSidebarLookups() {
  const projects = useProjects();
  const environments = useEnvironmentIdentities();
  const serverConfigs = useServerConfigs();
  const providerEntriesByEnvironment = useAtomValue(sidebarProviderEntriesAtom);
  const projectGroups = useSidebarProjectGroups();
  const environmentLabelById = new Map(
    environments.map((environment) => [environment.environmentId, environment.label] as const),
  );
  const projectByKey = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
  );
  const projectDisplayNameByKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
      ),
    ),
  );
  const projectGroupByScopeKey = new Map(
    projectGroups.map((project) => [project.projectKey, project] as const),
  );
  const projectScopeItems = [
    { value: "all", label: "All projects" },
    ...projectGroups.map((project) => ({ value: project.projectKey, label: project.displayName })),
  ];
  return {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
    projectGroupByScopeKey,
    projectScopeItems,
  };
}

function scheduleSnoozeWake(wakeAt: string | null, onWake: () => void): (() => void) | undefined {
  const wakeAtMs = wakeAt === null ? Number.NaN : Date.parse(wakeAt);
  if (Number.isNaN(wakeAtMs)) return undefined;
  // setTimeout delays are signed 32-bit: anything larger overflows and fires
  // immediately, turning a far-future wake (event-condition snoozes synced
  // from elsewhere) into a tight re-arm loop.
  const delayMs = Math.min(Math.max(0, wakeAtMs - Date.now()) + 50, 2_147_483_647);
  const id = window.setTimeout(onWake, delayMs);
  return () => window.clearTimeout(id);
}

function canOperateThreads(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  return threads.every((thread) =>
    readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
  );
}

function checkThreadOperations(
  threads: ReadonlyArray<Pick<SidebarThreadSummary, "environmentId">>,
): boolean {
  if (canOperateThreads(threads)) return true;
  toastManager.add({
    type: "error",
    title: "Thread action unavailable",
    description: "This connection cannot change one or more selected threads.",
  });
  return false;
}

const SIDEBAR_DRAG_DISTANCE = 6;

export default function Sidebar({ routeReveal }: { routeReveal: SidebarRouteReveal }) {
  const {
    projects,
    serverConfigs,
    projectGroups,
    environmentLabelById,
    providerEntriesByEnvironment,
    projectByKey,
    projectDisplayNameByKey,
    projectGroupByScopeKey,
    projectScopeItems,
  } = useSidebarLookups();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    setThreadAutoSettle,
    reorderPinnedThread,
    reorderActiveThread,
    markThreadUnread,
    archiveThread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({
        type: "success",
        title: "Branch copied",
        description: branch,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: ({ threadId }) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const newThreadContext = useHandleNewThread();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const acknowledgeWoke = useAcknowledgeThreadWoke();
  const routeTarget = useThreadRouteTarget();
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const environmentMachineById = useEnvironmentMachines();
  const projectGroupsRef = useRef(projectGroups);
  const persistedProjectScopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setPersistedProjectScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const [projectScopeMenuState, dispatchProjectScopeMenu] = useReducer(
    reduceSidebarProjectScopeMenuState,
    { open: false, query: "" },
  );
  const projectScopeFilter = useComboboxFilter();
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const allProjectConfigsReady = useAtomValue(environmentProjects.projectConfigsReadyAtom);
  const headerSearchRef = useRef<HTMLDivElement | null>(null);
  // Safari can send a click after Ctrl+click opens settings. Ignore that one
  // selection, then clear the guard when the picker opens again.
  const suppressNextScopeChangeRef = useRef(false);
  const highlightedProjectScopeKeyRef = useRef<string | null>(null);
  // Keep a dropped row at its destination while its server applies the
  // lifecycle command and any order-key writes. The next pickup waits for
  // this hold so a second drop cannot replace an unconfirmed placement.
  const [optimisticDrop, setOptimisticDrop] = useState<SidebarOptimisticDrop | null>(null);
  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [searchHighlight, setSearchHighlight] = useState({ orderKey: "", index: 0 });
  const searchEnvironmentIds = useConnectedEnvironmentIds();
  const threadSearch = useThreadSearch(searchEnvironmentIds, threadSearchQuery);
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  const queuePendingFileDrop = useSidebarPendingFileDropStore((s) => s.queuePendingFileDrop);
  const clearPendingFileDrop = useSidebarPendingFileDropStore((s) => s.clearPendingFileDrop);
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  // A group is named the moment it is made: its row opens straight into its
  // own rename, the way a new thread's title is edited in place.
  const [renamingGroupKey, setRenamingGroupKey] = useState<string | null>(null);
  const settlingThreadKeysRef = useRef(new Set<string>());
  const threadListRef = useRef<HTMLUListElement | null>(null);
  const listMotionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const [dragState, setDragState] = useState<{
    readonly activeKey: string;
    readonly activeSection: SidebarSection;
    readonly occurredAt: string;
    readonly activationY: number | null;
    readonly targetSection: SidebarSection | null;
    // The row this drag would join, when it hovers the middle of one rather
    // than the space between two.
    readonly joinTargetId: string | null;
    // The row the drop lands against, and on which side of it, so the list can
    // show where the release would put the row instead of leaving it to be
    // guessed from the gap that opens.
    readonly insertAnchor: { readonly id: string; readonly side: "above" | "below" } | null;
    readonly contextDrag: boolean;
  } | null>(null);
  const dragSensorRef = useRef<SidebarPointerSensor | null>(null);
  // The sensor's own pointer position. dnd-kit's delta folds in scrolling, and
  // the dragged card is clamped by a modifier, so neither answers "where is the
  // hand" — which is the only thing a drop decision should be read from.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // Where inside the row the hand took hold of it, so the card can hang from
  // that same point for the whole gesture.
  const grabOffsetRef = useRef<{ x: number; y: number } | null>(null);
  // The open gaps, as `restingY` last measured them. Nothing moves within one
  // step of the gesture, so both entry points below drop it and re-measure.
  const restingGapsRef = useRef<ReadonlyArray<{ top: number; height: number }> | null>(null);
  const contextDragKeyRef = useRef<string | null>(null);
  // A group's row answers for no thread, so what the ghost says is settled
  // when the drag starts rather than looked up per move.
  const dragGhostLabelRef = useRef<{ title: string; count: number } | null>(null);
  const [actionSweep, setActionSweep] = useState<{
    action: SidebarSweepAction;
    keys: ReadonlySet<string>;
  } | null>(null);
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const shortcutModifiers = useShortcutModifierState();
  const terminalFocused = useTerminalFocus();
  const openAddProjectCommandPalette = () => openCommandPalette({ open: "add-project" });
  const routeThreadRef = resolveActiveThreadRouteRef(routeTarget, routeDraftThread);
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeThreadKeyRef = useRef(routeThreadKey);

  // A selection made under one scope can hold threads the next scope hides.
  const setProjectScopeKey = (key: string | null) => {
    clearSelection();
    setPersistedProjectScopeKey(key);
  };
  const projectScopeKey = resolveSidebarProjectScopeKey({
    groups: projectGroups,
    key: persistedProjectScopeKey,
    settings: projectGroupingSettings,
  });
  const showProjectEnvironments = projectGroupsSpanEnvironments(projectGroups);
  const scratchMachineLabelFor = (
    thread: Pick<SidebarThreadSummary, "environmentId" | "projectId">,
  ) => {
    if (!showProjectEnvironments) return null;
    const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
    if (
      !project ||
      !isScratchProject(project, serverConfigs.get(thread.environmentId)?.scratchWorkspaceRoot)
    ) {
      return null;
    }
    return environmentLabelById.get(thread.environmentId) ?? null;
  };
  const selectedProjectScopeItem =
    projectScopeItems.find((item) => item.value === (projectScopeKey ?? "all")) ??
    projectScopeItems[0]!;
  const filteredProjectScopeItems = filterSidebarProjectScopeItems({
    items: projectScopeItems,
    query: projectScopeMenuState.query,
    matches: (item, query) =>
      projectScopeFilter.contains(item, query, (candidate) => candidate.label),
  });
  const scopedProjectGroup =
    projectScopeKey === null
      ? null
      : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null);
  const scopedProjectKeys =
    scopedProjectGroup === null
      ? null
      : new Set(
          scopedProjectGroup.memberProjectRefs.map(
            (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
          ),
        );
  useEffect(() => {
    const nextKey = resolveSidebarProjectScopeKey({
      groups: projectGroups,
      key: persistedProjectScopeKey,
      settings: projectGroupingSettings,
      canClearMissingScope: allProjectSnapshotsReady && allProjectConfigsReady,
    });
    if (nextKey !== persistedProjectScopeKey) {
      clearSelection();
      setPersistedProjectScopeKey(nextKey);
    }
  }, [
    allProjectConfigsReady,
    allProjectSnapshotsReady,
    clearSelection,
    persistedProjectScopeKey,
    projectGroups,
    projectGroupingSettings,
    setPersistedProjectScopeKey,
  ]);
  const routeDraftIdForRows = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const visibleDraftSessionCount = useComposerDraftStore((store) => {
    let count = 0;
    for (const [draftKey, session] of Object.entries(store.draftThreadsByThreadKey)) {
      if (session.promotedTo != null) {
        continue;
      }
      if (!composerDraftHasUserContent(store.draftsByThreadKey[draftKey])) {
        continue;
      }
      if (
        scopedProjectKeys !== null &&
        !scopedProjectKeys.has(`${session.environmentId}:${session.projectId}`)
      ) {
        continue;
      }
      count += 1;
    }
    return count;
  });

  const openProjectSettings = useStableCallback(
    (projectGroup: SidebarProjectSnapshot, projectRef?: ScopedProjectRef) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/projects/$projectKey",
        params: {
          projectKey: getSidebarProjectSettingsKey(
            projectGroup,
            projectGroupingSettings,
            projects,
            projectRef,
          ),
        },
      });
    },
  );
  const handleProjectSettings = useStableCallback(
    (
      event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLInputElement>,
      projectGroup: SidebarProjectSnapshot,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      suppressNextScopeChangeRef.current = true;
      dispatchProjectScopeMenu({ type: "project-settings-opened" });
      openProjectSettings(projectGroup);
    },
  );

  const {
    threads,
    workingShelfEnabled,
    pinnedThreads,
    draggableThreadKeys,
    activeReorderableThreadKeys,
    activeThreads,
    workingThreads,
    snoozedThreads,
    settledThreads,
    snoozeNow,
    searchableThreads,
    hiddenSettledCount,
    showMoreSettled,
    settledShelfExpanded,
    toggleSettledShelf,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
    workingShelfExpanded,
    toggleWorkingShelf,
    pinnedEntries,
    activeEntries,
    workingEntries,
    settledEntries,
    snoozedEntries,
    manualGroups,
    setManualGroups,
    setUngroupedThreads,
    groupKeyOf,
    membersOfGroup,
    liveGroupKeys,
    toggleGroup,
    orderedThreadKeys,
    threadByKey,
    threadByAnyKey,
    settledThreadKeys,
    snoozedThreadKeys,
    sectionByThreadKey,
    pinnedKeys,
    activeKeys,
    pinnedKeysById,
    activeKeysById,
    routeRowThreadKey,
  } = useSidebarThreads({
    projectScopeKey,
    scopedProjectKeys,
    serverConfigs,
    optimisticDrop,
    routeThreadRef,
  });

  const isSearchingThreads = threadSearchQuery.trim().length > 0;

  // History, the command palette, and links can open a thread the project
  // scope hides or the list has scrolled away. A remount starts the list at
  // the top, so each mount also scrolls to the open thread once, without
  // widening the scope.
  const mountRevealOwed = useRef(true);
  const revealRouteRow = useStableCallback(() => {
    const pendingKey = pendingSidebarRouteReveal(routeReveal, routeRowThreadKey);
    // Search results replace the thread list; reveal once the list returns.
    if (isSearchingThreads) return;
    const revealKey = pendingKey ?? (mountRevealOwed.current ? routeRowThreadKey : null);
    if (revealKey === null) return;
    const thread = threads.find((candidate) => threadShellKey(candidate) === revealKey);
    if (thread === undefined) return;
    if (
      pendingKey !== null &&
      scopedProjectKeys !== null &&
      filterSidebarV2VisibleThreads([thread], scopedProjectKeys).length === 0 &&
      filterSidebarV2VisibleThreads([thread], null).length === 1
    ) {
      // The row renders under the widened scope; scroll on that pass.
      setProjectScopeKey(null);
      return;
    }
    const activeRow = document.querySelector('[data-sidebar="content"] [aria-current="page"]');
    if (!activeRow) return;
    completeSidebarRouteReveal(routeReveal);
    mountRevealOwed.current = false;
    activeRow.scrollIntoView({ block: "nearest" });
  });
  useEffect(revealRouteRow, [
    revealRouteRow,
    routeRowThreadKey,
    threads,
    projectScopeKey,
    isSearchingThreads,
  ]);

  const threadSearchMatchByKey = new Map(
    threadSearch.matches.map((match) => [threadSearchMatchKey(match), match] as const),
  );
  const threadSearchResults = searchSidebarThreads(
    searchableThreads,
    threadSearchQuery,
    new Set(threadSearchMatchByKey.keys()),
  );
  const threadSearchResultOrderKey = threadSearchResults
    .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
    .join("\0");

  // The highlight belongs to one result list; a new list starts at the top.
  const activeSearchResultIndex =
    searchHighlight.orderKey === threadSearchResultOrderKey ? searchHighlight.index : 0;
  const setActiveSearchResultIndex = (index: number | ((index: number) => number)) =>
    setSearchHighlight((current) => {
      const currentIndex = current.orderKey === threadSearchResultOrderKey ? current.index : 0;
      return {
        orderKey: threadSearchResultOrderKey,
        index: typeof index === "function" ? index(currentIndex) : index,
      };
    });
  const activeSearchResult = isSearchingThreads
    ? threadSearchResults[activeSearchResultIndex]
    : undefined;
  const activeSearchResultKey =
    activeSearchResult === undefined
      ? null
      : scopedThreadKey(scopeThreadRef(activeSearchResult.environmentId, activeSearchResult.id));
  useEffect(() => {
    if (activeSearchResultKey === null) return;
    document
      .querySelector(`[data-search-result-key="${globalThis.CSS.escape(activeSearchResultKey)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSearchResultKey]);

  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  const manualGroupsRef = useRef(manualGroups);
  const settledThreadKeysRef = useRef(settledThreadKeys);
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);

  const jumpLabelByKey = (() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  })();
  const { showThreadJumpHints: showJumpHints, updateThreadJumpHintsVisibility } =
    useThreadJumpHintVisibility();

  const navigateToThread = (threadRef: ScopedThreadRef) => {
    if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
      clearSelection();
    }
    setSelectionAnchor(scopedThreadKey(threadRef));
    if (isMobile) {
      setOpenMobile(false);
    }
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };

  const handleThreadFileDrop = async (threadRef: ScopedThreadRef, files: File[]) => {
    const dropId = queuePendingFileDrop({ threadRef, files });
    const landedBefore =
      router.buildLocation({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      }).pathname === router.state.location.pathname;
    if (landedBefore) return;

    try {
      await navigateToThread(threadRef);
      const landed =
        router.buildLocation({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        }).pathname === router.state.location.pathname;
      if (!landed) clearPendingFileDrop(dropId);
    } catch {
      clearPendingFileDrop(dropId);
    }
  };

  const navigateToDraft = (draftId: DraftId) => {
    clearSelection();
    if (isMobile) {
      setOpenMobile(false);
    }
    void router.navigate({ to: "/draft/$draftId", params: { draftId } });
  };

  const clearThreadSearch = () => {
    setThreadSearchQuery("");
    setActiveSearchResultIndex(0);
  };
  const selectThreadSearchResult = (thread: EnvironmentThreadShell) => {
    clearThreadSearch();
    navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
  };
  const handleThreadSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && isSearchingThreads) {
      event.preventDefault();
      event.stopPropagation();
      clearThreadSearch();
      return;
    }
    if (threadSearchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchResultIndex((index) => (index + 1) % threadSearchResults.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchResultIndex(
        (index) => (index - 1 + threadSearchResults.length) % threadSearchResults.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = threadSearchResults[activeSearchResultIndex];
      if (result) selectThreadSearchResult(result);
    }
  };

  const startThreadRename = (threadRef: ScopedThreadRef, title: string) => {
    if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  };
  const cancelThreadRename = () => setRenamingThreadKey(null);
  const commitThreadRename = (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
    void (async () => {
      if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
      const trimmed = title.trim();
      setRenamingThreadKey(null);
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        return;
      }
      if (trimmed === originalTitle) return;
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: trimmed },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  const handleThreadClick = (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
    if (isSidebarNestedLinkClick(event.target)) return;
    const isMac = isMacPlatform(navigator.platform);
    const isModClick = isMac ? event.metaKey : event.ctrlKey;
    const threadKey = scopedThreadKey(threadRef);
    if (isModClick) {
      event.preventDefault();
      toggleThreadSelection(threadKey);
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      rangeSelectTo(threadKey, orderedThreadKeysRef.current);
      return;
    }
    if (isTrailingDoubleClick(event.detail)) {
      return;
    }
    navigateToThread(threadRef);
  };

  // Callers snapshot the plan BEFORE the command mutates the partition;
  // background parks never navigate (null plan).
  const planForwardNavigation = (
    threadKey: string,
    coParkingKeys?: ReadonlySet<string>,
  ): (() => void) | null => {
    if (routeThreadKeyRef.current !== threadKey) return null;
    const shell = threadByKeyRef.current.get(threadKey);
    const orderedKeys = orderedThreadKeysRef.current;
    const settledKeys = settledThreadKeysRef.current;
    const snoozedKeys = snoozedThreadKeysRef.current;
    const currentIndex = orderedKeys.indexOf(threadKey);
    const nextCardKey =
      currentIndex === -1
        ? null
        : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
            (key) => !settledKeys.has(key) && !snoozedKeys.has(key) && !coParkingKeys?.has(key),
          ) ?? null);
    const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
    return nextThread
      ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
      : shell
        ? () =>
            void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
        : () => void router.navigate({ to: "/" });
  };

  const attemptSettle = (
    threadRef: ScopedThreadRef,
    opts: { coSettlingKeys?: ReadonlySet<string> } = {},
  ) => {
    void (async () => {
      const threadKey = scopedThreadKey(threadRef);
      if (settlingThreadKeysRef.current.has(threadKey)) return;
      settlingThreadKeysRef.current.add(threadKey);
      const navigateAfterSettle = planForwardNavigation(threadKey, opts.coSettlingKeys);
      const result = await settleThread(threadRef);
      settlingThreadKeysRef.current.delete(threadKey);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to settle thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
      if (
        shouldNavigateAfterThreadPark({
          threadKey,
          currentThreadKey: routeThreadKeyRef.current,
          action: "settle",
          now: new Date().toISOString(),
          thread: readThreadShell(threadRef),
        })
      ) {
        navigateAfterSettle?.();
      }
    })();
  };
  useEffect(() => registerSettleAndAdvance(attemptSettle), [attemptSettle]);
  const settleThreads = (threadKeys: readonly string[]) => {
    const coSettlingKeys = new Set(threadKeys);
    for (const threadKey of threadKeys) {
      const thread = threadByAnyKey.get(threadKey);
      if (!thread || thread.settledOverride === "settled") continue;
      attemptSettle(scopeThreadRef(thread.environmentId, thread.id), { coSettlingKeys });
    }
  };
  const attemptUnsettle = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsettleThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to un-settle thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const attemptUnsnooze = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await unsnoozeThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to wake thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  // dnd-kit offsets the card from where its row sits *now*, and the row has
  // moved since the grab: the shelf labels and the Pinned well opened above
  // it. Reading the row's live rect and subtracting the transform back out
  // gives the slot's untransformed position, which is what the card has to be
  // offset from for the hand to keep holding it where it took it.
  const stickToGrabPoint: Modifier = ({ active, transform }) => {
    const grab = grabOffsetRef.current;
    const pointer = pointerRef.current;
    const list = threadListRef.current;
    if (grab === null || pointer === null || active === null || list === null) return transform;
    const node = sidebarRow(list, String(active.id));
    const origin = node === null ? null : sidebarSlotOrigin(node);
    if (node === null || origin === null) return transform;
    return { ...transform, x: pointer.x - grab.x - origin.x, y: pointer.y - grab.y - origin.y };
  };
  // A new array re-renders DndContext and with it every sortable row.
  const dndModifiers = [stickToGrabPoint];
  const attachListMotionRef = (node: HTMLUListElement | null) => {
    threadListRef.current = node;
    listMotionRef.current?.dispose();
    listMotionRef.current = node === null ? null : createSidebarListMotion(node);
    listMotionRef.current?.update(false);
  };

  // Working rows can supply chat context, but never preview sidebar movement.
  const isContextDrag = dragState?.contextDrag === true || dragState?.activeSection === "working";
  const dragTargetSection = isContextDrag ? null : (dragState?.targetSection ?? null);
  const finishThreadDrag = (started: boolean) => {
    dragSensorRef.current = null;
    contextDragKeyRef.current = null;
    dragGhostLabelRef.current = null;
    grabOffsetRef.current = null;
    endThreadContextDrag();
    if (started) {
      listMotionRef.current?.release();
      setDragState(null);
    }
  };
  const attachDragSensor = (sensor: SidebarPointerSensor) => {
    dragSensorRef.current = sensor;
  };
  // Stable on purpose: `SidebarDragLifecycle` runs this as a layout effect's
  // cleanup, which React also runs whenever the callback's identity changes.
  // A fresh function on a render that happens mid-drag therefore cancels the
  // drag that render was for — the gesture dies one move after it starts.
  const cancelThreadDrag = useStableCallback(() => {
    dragSensorRef.current?.cancel();
  });
  const contextDragThreads = (): ReadonlyArray<ScopedThreadRef> => {
    const key = contextDragKeyRef.current;
    if (key === null) return [];
    const selected = useThreadSelectionStore.getState().selectedThreadKeys;
    const keys = selected.has(key) ? [...selected] : [key];
    return keys.flatMap((candidate) => {
      const ref = parseScopedThreadKey(candidate);
      return ref ? [ref] : [];
    });
  };
  const pointerOutsideThreadList = (point: { x: number; y: number }) => {
    const bounds = threadListRef.current?.getBoundingClientRect();
    return bounds !== undefined && (point.x < bounds.left || point.x > bounds.right);
  };
  const moveThreadContextDrag = (point: { x: number; y: number }) => {
    pointerRef.current = point;
    const contextDrag = pointerOutsideThreadList(point);
    setDragState((current) =>
      current === null || current.contextDrag === contextDrag
        ? current
        : { ...current, contextDrag },
    );
    if (!contextDrag) {
      endThreadContextDrag();
      return false;
    }
    // A group's row answers for no thread, so its own name is settled at the
    // start of the drag rather than looked up here.
    const label = dragGhostLabelRef.current ?? {
      title: threadByKeyRef.current.get(contextDragKeyRef.current ?? "")?.title.trim() || "Thread",
      count: contextDragThreads().length,
    };
    moveThreadContextDragGhost(point, label);
    return true;
  };
  const dropThreadContextDrag = (point: { x: number; y: number }) => {
    if (!pointerOutsideThreadList(point)) return false;
    dropThreadContext(point, contextDragThreads());
    return true;
  };
  // useSensor memoizes on the options object; a fresh one each render rebuilds
  // the sensors, and with them DndContext and every sortable row.
  const pointerSensorOptions = {
    distance: SIDEBAR_DRAG_DISTANCE,
    onAttach: attachDragSensor,
    onFinish: finishThreadDrag,
    onMove: moveThreadContextDrag,
    onDrop: dropThreadContextDrag,
  };
  const dndSensors = useSensors(useSensor(SidebarPointerSensor, pointerSensorOptions));
  const sectionByThreadKeyRef = useRef(sectionByThreadKey);
  useLayoutEffect(() => {
    routeThreadKeyRef.current = routeThreadKey;
    projectGroupsRef.current = projectGroups;
    orderedThreadKeysRef.current = orderedThreadKeys;
    threadByKeyRef.current = threadByKey;
    manualGroupsRef.current = manualGroups;
    handleNewThreadRef.current = newThreadContext.handleNewThread;
    settledThreadKeysRef.current = settledThreadKeys;
    snoozedThreadKeysRef.current = snoozedThreadKeys;
    sectionByThreadKeyRef.current = sectionByThreadKey;
  });
  const startActionSweep = useStableCallback(
    (threadRef: ScopedThreadRef, action: SidebarSweepAction, event: PointerEvent) => {
      const originKey = scopedThreadKey(threadRef);
      const originSection = sectionByThreadKeyRef.current.get(originKey);
      const canApply = (key: string) => {
        const thread = threadByKeyRef.current.get(key);
        const capabilities =
          thread && serverConfigs.get(thread.environmentId)?.environment.capabilities;
        return (
          thread !== undefined &&
          sectionByThreadKeyRef.current.get(key) === originSection &&
          (action === "unsnooze"
            ? capabilities?.threadSnooze === true
            : capabilities?.threadSettlement === true)
        );
      };
      let targetKey: string | null = null;
      let sweptKeys: string[] = [];
      const sweepTo = (key: string | null) => {
        if (key === null || key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(orderedThreadKeysRef.current, originKey, key, canApply);
        setActionSweep({ action, keys: new Set(sweptKeys) });
      };
      dragSensorRef.current = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: SIDEBAR_DRAG_DISTANCE,
          onAttach: () => {},
          onFinish: () => {
            dragSensorRef.current = null;
            setActionSweep(null);
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) =>
          sweepTo(threadListRef.current && sidebarThreadKeyAtY(threadListRef.current, y)),
        onEnd: () => {
          const keys = sweptKeys.filter(canApply);
          if (action === "settle") {
            settleThreads(keys);
            return;
          }
          for (const key of keys) {
            const ref = parseScopedThreadKey(key);
            if (ref === null) continue;
            if (action === "unsettle") attemptUnsettle(ref);
            else attemptUnsnooze(ref);
          }
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
  );
  // Release the hold during render once the server state catches up, so the
  // canonical order shows in the same frame instead of after an effect pass.
  if (
    optimisticDrop !== null &&
    isOptimisticDropReleased({
      optimisticDrop,
      threads,
      pinnedKeys,
      activeKeys,
      now: snoozeNow,
    })
  ) {
    setOptimisticDrop(null);
  }
  const attemptPin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      // Fresh pins take the top of the arranged run: pinThread computes a
      // key before the smallest key across ALL pinned shells — including
      // snoozed pins hidden from this list, whose keys are still part of
      // the run — so the new pin can't land beneath a hidden head.
      const result = await pinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to pin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };
  const unsettleThreads = (threadKeys: readonly string[]) => {
    for (const threadKey of threadKeys) {
      const thread = threadByAnyKey.get(threadKey);
      if (!thread || thread.settledOverride !== "settled") continue;
      attemptUnsettle(scopeThreadRef(thread.environmentId, thread.id));
    }
  };
  const unpinThreads = (threadKeys: readonly string[]) => {
    for (const threadKey of threadKeys) {
      const thread = threadByAnyKey.get(threadKey);
      if (!thread || thread.pinnedAt == null) continue;
      // The group's row is the deliberate gesture; the per-thread confirmation
      // would ask once for each of them.
      void unpinThread(scopeThreadRef(thread.environmentId, thread.id));
    }
  };
  const pinThreads = (threadKeys: readonly string[]) => {
    for (const threadKey of threadKeys) {
      const thread = threadByAnyKey.get(threadKey);
      if (!thread || thread.pinnedAt != null) continue;
      attemptPin(scopeThreadRef(thread.environmentId, thread.id));
    }
  };
  const attemptUnpin = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const result = await confirmAndUnpinThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to unpin thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    })();
  };

  // The members of one row, which is not the members of its group:
  // `membersOfGroup` answers for every section, and a row speaks for the
  // threads on its own shelf alone. The list already carries them.
  const groupItemMemberKeys = (itemId: string): readonly string[] => {
    const item = sidebarListItems.find((candidate) => sidebarListItemId(candidate) === itemId);
    return item?.kind === "group" ? item.memberKeys : [];
  };
  const handleThreadDragStart = (event: DragStartEvent) => {
    const activeKey = String(event.active.id);
    contextDragKeyRef.current = activeKey;
    const draggedGroupKey = sidebarGroupKeyFromItemId(activeKey);
    dragGhostLabelRef.current =
      draggedGroupKey === null
        ? null
        : {
            title: manualGroupNameOf(manualGroups, draggedGroupKey) ?? draggedGroupKey,
            count: groupItemMemberKeys(activeKey).length,
          };
    // A group sits wherever its members sit, so its first one answers for it.
    const activeSection =
      draggedGroupKey === null
        ? sectionByThreadKey.get(activeKey)
        : sectionByThreadKey.get(groupItemMemberKeys(activeKey)[0] ?? "");
    if (activeSection === undefined) return;
    listMotionRef.current?.suspend();
    // Read before this render collapses the row's slot: its height is the gap
    // the drop has to leave, and the grab point is where the card hangs from.
    const rowRect = sidebarRowRect(threadListRef.current, activeKey);
    const activator = event.activatorEvent;
    grabOffsetRef.current =
      rowRect === null || !(activator instanceof PointerEvent)
        ? null
        : { x: activator.clientX - rowRect.left, y: activator.clientY - rowRect.top };
    setDragState({
      activeKey,
      activeSection,
      targetSection: activeSection,
      joinTargetId: null,
      insertAnchor: null,
      contextDrag: false,
      occurredAt: new Date().toISOString(),
      activationY:
        event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null,
    });
  };
  // One pass over the laid-out entries gives both what a row needs for its
  // rail and what a folded group's row shows in place of its members.
  const groupEntryByThreadKey = new Map<
    string,
    { readonly group: ThreadGroup; readonly isGroupEnd: boolean }
  >();
  // Keyed by shelf and group, because a group keeps a row on every shelf its
  // threads reach and each row stands for the threads on that shelf alone. By
  // group alone, Pinned's row would list the inbox's threads, write their keys
  // into the pinned order, and read its fold from whichever shelf wrote last.
  const groupByKey = new Map<string, ThreadGroup>();
  const groupMembersByKey = new Map<string, SidebarGroupMember[]>();
  for (const [entries, section] of [
    [pinnedEntries, "pinned"],
    [activeEntries, "active"],
    [workingEntries, "working"],
    [settledEntries, "settled"],
    [snoozedEntries, "snoozed"],
  ] as const) {
    for (const entry of entries) {
      if (entry.kind === "group") {
        groupByKey.set(groupShelfKey(entry.group.key, section), entry.group);
        continue;
      }
      if (entry.group === null) continue;
      const key = threadShellKey(entry.thread);
      groupEntryByThreadKey.set(key, { group: entry.group, isGroupEnd: entry.isGroupEnd });
    }
  }
  for (const [threads, section] of [
    [pinnedThreads, "pinned"],
    [activeThreads, "active"],
    [workingThreads, "working"],
    [settledThreads, "settled"],
    [snoozedThreads, "snoozed"],
  ] as const)
    for (const thread of threads) {
      const plainKey = groupKeyOf(thread);
      const groupKey = plainKey === null ? null : groupShelfKey(plainKey, section);
      if (groupKey === null || !groupByKey.has(groupKey)) continue;
      const status = resolveSidebarThreadStatus(thread);
      const members = groupMembersByKey.get(groupKey) ?? [];
      members.push({
        key: threadShellKey(thread),
        project: projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null,
        tone: threadWantsAnAnswer(thread)
          ? "attention"
          : status === "working" || status === "waiting"
            ? "working"
            : "done",
        title: thread.title,
        thread,
        providerEntryByInstanceId:
          providerEntriesByEnvironment.get(thread.environmentId) ?? EMPTY_PROVIDER_ENTRIES,
        canSettle:
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
            true && thread.settledOverride !== "settled",
        isSettled: thread.settledOverride === "settled",
        isPinned: thread.pinnedAt != null,
        canSnooze:
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: snoozeNow }),
      });
      groupMembersByKey.set(groupKey, members);
    }
  const sidebarListItemsFresh = ((): readonly SidebarListItem[] => {
    // A group's row sits in the list beside its members, so the fold, the
    // motion pass and the sortable context all see one flat list as before.
    const itemsOf = (
      entries: readonly ThreadGroupEntry<EnvironmentThreadShell>[],
      section: SidebarSection,
    ): SidebarListItem[] =>
      entries.flatMap((entry): SidebarListItem[] =>
        entry.kind === "group"
          ? [
              {
                kind: "group",
                groupKey: entry.group.key,
                section,
                memberKeys: (
                  groupMembersByKey.get(groupShelfKey(entry.group.key, section)) ?? []
                ).map((member) => member.key),
              } as const,
            ]
          : // The open thread a fold kept holds its place in the order without
            // taking a row: the group's own row stands in for it.
            entry.group?.collapsed === true
            ? []
            : [
                {
                  kind: "thread",
                  key: scopedThreadKey(scopeThreadRef(entry.thread.environmentId, entry.thread.id)),
                  section,
                } as const,
              ],
      );
    if (
      pinnedThreads.length +
        activeThreads.length +
        workingThreads.length +
        snoozedThreads.length +
        settledThreads.length ===
      0
    ) {
      return [];
    }
    const items: SidebarListItem[] = [{ kind: "marker", marker: "pinned-header" }];
    items.push(...itemsOf(pinnedEntries, "pinned"));
    items.push({ kind: "marker", marker: "pinned-divider" });
    const activeRows = itemsOf(activeEntries, "active");
    items.push({ kind: "marker", marker: "active-placeholder" });
    items.push(...activeRows);
    if (workingThreads.length > 0) {
      items.push({ kind: "marker", marker: "working-header" });
      items.push(...itemsOf(workingEntries, "working"));
    }
    if (snoozedThreads.length > 0) {
      items.push({ kind: "marker", marker: "snoozed-header" });
      items.push(...itemsOf(snoozedEntries, "snoozed"));
    }
    items.push({ kind: "marker", marker: "settled-header" });
    items.push({ kind: "marker", marker: "settled-placeholder" });
    items.push(...itemsOf(settledEntries, "settled"));
    return items;
  })();
  // Thread shells update on every streamed event without moving rows. Keep the
  // list's identity until its order changes, so the sorting strategy, the
  // sortable context and every sortable row stay memoized meanwhile.
  const sidebarListItemsKey = sidebarListItemsFresh
    .map((item) =>
      item.kind === "thread"
        ? item.section + ":" + item.key
        : item.kind === "group"
          ? "group:" + item.section + ":" + item.groupKey
          : item.marker,
    )
    .join("\n");
  const [sidebarListItemsState, setSidebarListItems] = useState(sidebarListItemsFresh);
  const [sidebarListItemsKeyState, setSidebarListItemsKeyState] = useState(sidebarListItemsKey);
  let sidebarListItems = sidebarListItemsState;
  if (sidebarListItemsKeyState !== sidebarListItemsKey) {
    setSidebarListItemsKeyState(sidebarListItemsKey);
    setSidebarListItems(sidebarListItemsFresh);
    // The rest of this render still runs before React applies the update, and
    // threadByKey already lacks rows that just left, such as a thread settled
    // into the collapsed Settled shelf.
    sidebarListItems = sidebarListItemsFresh;
  }
  // The row being dragged left the list, so the gesture has nothing left to
  // carry. By its own id, not by thread key: a group's row is dragged too, and
  // looking only for a thread made every group drag cancel itself one move in.
  useEffect(() => {
    if (
      dragState !== null &&
      !sidebarListItems.some((item) => sidebarListItemId(item) === dragState.activeKey)
    ) {
      cancelThreadDrag();
    }
  }, [cancelThreadDrag, dragState, sidebarListItems]);
  // Rows only move when the rendered order, a row's section, or the draft block
  // changes. Running the motion pass on that alone keeps ordinary shell events
  // from forcing a layout read and animating rows that drifted for other reasons.
  const listMotionLayoutKey = [
    sidebarListItemsKey,
    visibleDraftSessionCount,
    routeDraftIdForRows ?? "",
  ].join("\0");
  const listMotionAnimate =
    dragState === null && sidebarListItems.length + visibleDraftSessionCount > 0;
  // The effect reads only `animate`; the pass object is cached on both fields,
  // so a new layout key alone also triggers it.
  const listMotionPass = { layoutKey: listMotionLayoutKey, animate: listMotionAnimate };
  useLayoutEffect(() => {
    listMotionRef.current?.update(listMotionPass.animate);
  }, [listMotionPass]);
  // Both the hover and the move feed this: dnd-kit only reports a hover when
  // the row under the pointer changes, so a side read there alone never
  // flipped while the pointer crossed the row it was already over.
  const handleThreadDragOver = (event: DragOverEvent | DragMoveEvent) => {
    restingGapsRef.current = null;
    const draggedGroupKey = sidebarGroupKeyFromItemId(String(event.active.id));
    const activeRect = event.active.rect.current.translated;
    const overId = event.over === null ? null : String(event.over.id);
    const liveOverRect =
      (overId === null ? null : sidebarRowRect(threadListRef.current, overId)) ??
      event.over?.rect ??
      null;
    const overRect =
      liveOverRect === null
        ? null
        : { top: restingY(liveOverRect.top), height: liveOverRect.height };
    // The pointer, not the card: a modifier holds the card below the Pinned
    // label, so near the top of the list the card trails the hand by a couple
    // of dozen pixels and every decision taken on it is taken too low.
    // The hand, read in the same list the rows are read in.
    const pointerY = pointerRef.current === null ? null : restingY(pointerRef.current.y);
    const reach = pointerY ?? (activeRect === null ? null : activeRect.top + activeRect.height / 2);
    const hoveredSide: "above" | "below" | undefined =
      reach === null || overRect === null
        ? undefined
        : reach < overRect.top + overRect.height / 2
          ? "above"
          : "below";
    const target = !event.over
      ? null
      : draggedGroupKey === null
        ? resolveSidebarDropTarget(
            sidebarListItems,
            String(event.active.id),
            String(event.over.id),
            hoveredSide,
          )
        : planSidebarGroupMove(
            sidebarListItems,
            String(event.active.id),
            String(event.over.id),
            hoveredSide,
          );
    const overItem =
      overId === null
        ? undefined
        : sidebarListItems.find((item) => sidebarListItemId(item) === overId);
    // Only where a group can exist. Joining a settled or snoozed row made a
    // manual group the layout never renders, which took the thread out of its
    // ticket's group with no row left to take it out of.
    const joinableSection =
      overItem !== undefined &&
      overItem.kind !== "marker" &&
      (overItem.section === "active" || overItem.section === "working");
    const joinable =
      draggedGroupKey === null &&
      joinableSection &&
      (overItem.kind === "thread" || overItem.kind === "group");
    const joinTargetId =
      !isContextDrag &&
      event.over !== null &&
      activeRect !== null &&
      joinable &&
      overId !== event.active.id &&
      reach !== null &&
      overRect !== null &&
      isGroupJoinHover({
        activeTop: reach,
        activeHeight: 0,
        overTop: overRect.top,
        overHeight: overRect.height,
      })
        ? overId
        : null;
    // The edge of the hovered row the drop belongs to, read from the dragged
    // card itself: the row it is nearest the top of is the row it goes above.
    // Only a row carries a zone. Over the dragged row itself, over a shelf
    // boundary, or over anything a group may not land in, the last zone is
    // held rather than blinked out — a gesture that loses its answer every
    // time it passes a marker reads as the list flickering.
    const anchorRow = overId === null || overId === event.active.id ? null : (overItem ?? null);
    // A shelf with no rows of its own shows a well where its first row would
    // go, and two wells are two answers to one gesture.
    const shelfWell =
      target !== null &&
      (target.section === "pinned"
        ? pinnedThreads.length === 0
        : target.section === "settled"
          ? settledThreads.length === 0
          : activeThreads.length === 0);
    const nextAnchor: SidebarDropSlot | "hold" | null =
      joinTargetId !== null || hoveredSide === undefined || shelfWell
        ? null
        : anchorRow === null || anchorRow.kind === "marker" || target === null
          ? "hold"
          : { id: overId!, side: hoveredSide };
    // The band under a shelf is that shelf's own last slot, and a group
    // already on it has no use for it: there, the only thing the gesture can
    // mean is leaving. Without this the hand stops just short of the inbox and
    // the release reorders the shelf it never left.
    const leavingShelf =
      draggedGroupKey !== null &&
      dragState?.activeSection === "pinned" &&
      overId === sidebarMarkerId("pinned-divider");
    const groupShelf =
      draggedGroupKey === null
        ? null
        : leavingShelf
          ? "active"
          : groupShelfDrop(overId, hoveredSide);
    setDragState((current) => {
      if (current === null || current.activeKey !== String(event.active.id)) return current;
      const nextSection = target?.section ?? groupShelf;
      const insertAnchor = nextAnchor === "hold" ? current.insertAnchor : nextAnchor;
      // Pointer moves arrive at the frame rate; a fresh object for each one
      // re-renders the whole sidebar, which is most of a drag's cost.
      if (
        current.targetSection === nextSection &&
        current.joinTargetId === joinTargetId &&
        current.insertAnchor?.id === insertAnchor?.id &&
        current.insertAnchor?.side === insertAnchor?.side
      )
        return current;
      return { ...current, targetSection: nextSection, joinTargetId, insertAnchor };
    });
  };
  const sortableIds = sidebarListItems.map(sidebarListItemId);
  const draggedThreadKey = dragState?.activeKey;
  const draggedFromSection = dragState?.activeSection;
  const dragActivationY = dragState?.activationY;
  const isGroupJoinable = sidebarGroupKeyFromItemId(draggedThreadKey ?? "") === null;
  const isJoinableTargetId = (id: string) => {
    const item = sidebarListItems.find((candidate) => sidebarListItemId(candidate) === id);
    if (item === undefined || item.kind === "marker") return false;
    return item.section === "active" || item.section === "working";
  };
  /**
   * A position in the list as it would be with no gap open.
   *
   * The gap a drop zone opens pushes every row below it down by its own
   * height. Decide on where the rows are *then*, and the decision moves the
   * gap, which moves them again: cross a row's middle and it jumps out from
   * under the hand — the row the gesture skips. So the gap is subtracted back
   * out and both the rows and the pointer are read in the list at rest, where
   * nothing moves for the length of the drag.
   *
   * Only the part of a gap that is above the point counts, so crossing one is
   * continuous. Inside it the answer holds still, which is the hysteresis that
   * keeps a hand resting in a gap from being thrown out of it.
   *
   * A shelf's standing well (Pinned, Settled) is part of that rest: it is open
   * for the whole drag, so it never enters this.
   */
  const restingY = useStableCallback((y: number) => {
    // Measured once per step of the gesture: the collision pass asks this for
    // every row, and a list where every interstice is a gap would otherwise
    // read every gap's box once per row.
    const gaps =
      restingGapsRef.current ??
      (restingGapsRef.current = [
        ...(threadListRef.current?.querySelectorAll<HTMLElement>(
          '[data-testid="sidebar-drop-zone"]',
        ) ?? []),
      ]
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.height > 0)
        .map((rect) => ({ top: rect.top, height: rect.height })));
    let shift = 0;
    for (const gap of gaps) shift += Math.min(gap.height, Math.max(0, y - gap.top));
    return y - shift;
  });
  // The hand's own position, which only the collision pass is given. Every
  // decision a move takes is taken on it rather than on the dragged card: the
  // card is held below the Pinned label and is half a card tall, so its centre
  // answers for a point the hand is nowhere near.
  const trackPointer =
    (detection: CollisionDetection): CollisionDetection =>
    (args) => {
      restingGapsRef.current = null;
      if (args.pointerCoordinates !== null) pointerRef.current = args.pointerCoordinates;
      return detection(args);
    };
  /**
   * Pinning or settling a whole group, which is what releasing its row on a
   * shelf means. The group has no move to plan there — it is leaving the inbox
   * — so the shelf is read from the list rather than from a drop target.
   */
  const groupShelfDrop = (overId: string | null, side?: "above" | "below") => {
    if (overId === null) return null;
    const section = sidebarSectionAtSlot(sidebarListItems, overId, side);
    return section === "pinned" || section === "settled" ? section : null;
  };
  const dndCollisionDetection = trackPointer(
    (() => {
      if (draggedThreadKey === undefined || draggedFromSection === undefined)
        return createSidebarCollisionDetection(() => true);
      const draggedGroupKey = sidebarGroupKeyFromItemId(draggedThreadKey);
      if (draggedGroupKey !== null) {
        return createSidebarCollisionDetection(
          // The collision pass has no side to offer, so a marker counts when
          // either of its sides is a shelf.
          (id) =>
            planSidebarGroupMove(sidebarListItems, draggedThreadKey, id) !== null ||
            groupShelfDrop(id) !== null ||
            groupShelfDrop(id, "below") !== null,
          { items: sidebarListItems, activationY: dragActivationY ?? null, restingY },
        );
      }
      const source = threadByKey.get(draggedThreadKey);
      if (source === undefined) return createSidebarCollisionDetection(() => false);
      return createSidebarCollisionDetection(
        (id) => {
          // A row whose insertion would move nothing is still a target worth
          // keeping: dropping onto its middle groups into it, and the neighbour
          // of the dragged row — where inserting is a no-op — is the first row
          // anyone tries to group with.
          // A join candidate only: the plan below is what says whether an
          // insertion there would do anything at all, and a target that shows a
          // drop zone and then does nothing is worse than no target.
          if (id !== draggedThreadKey && isJoinableTargetId(id) && isGroupJoinable) return true;
          const target = resolveSidebarDropTarget(sidebarListItems, draggedThreadKey, id);
          if (target === null) return false;
          return (
            planSidebarThreadDrop({
              activeKey: draggedThreadKey,
              activeSection: draggedFromSection,
              activePinned: source.pinnedAt != null,
              activeSettled: source.settledOverride === "settled",
              supportsSettlement:
                serverConfigs.get(source.environmentId)?.environment.capabilities
                  .threadSettlement === true,
              target,
              pinnedOrder: pinnedKeys,
              pinnedKeysById,
              reorderableKeys: draggableThreadKeys,
              activeOrder: activeKeys,
              activeKeysById,
              activeReorderableKeys: activeReorderableThreadKeys,
              activeTimeOrdered: workingShelfEnabled,
            }).kind !== "none"
          );
        },
        {
          items: sidebarListItems,
          activationY: dragActivationY ?? null,
          restingY,
        },
      );
    })(),
  );
  /**
   * A drop onto a row, rather than between two. It only rearranges this
   * device's grouping, so nothing goes to the server and the optimistic-drop
   * machinery the ordinary drops use stays out of it.
   */
  const applyGroupDrop = (draggedKey: string, joinTargetId: string) => {
    const targetGroupKeyFromRow = sidebarGroupKeyFromItemId(joinTargetId);
    const targetThreadKey = targetGroupKeyFromRow === null ? joinTargetId : null;
    const targetGroupKey =
      targetGroupKeyFromRow ??
      (targetThreadKey === null
        ? null
        : (groupEntryByThreadKey.get(targetThreadKey)?.group.key ?? null));
    const targetTitle =
      targetThreadKey === null ? null : (threadByKey.get(targetThreadKey)?.title ?? null);
    const draggedTitle = threadByKey.get(draggedKey)?.title ?? null;
    const drop = {
      draggedKey,
      targetGroupKey,
      targetGroupMembers:
        targetGroupKey === null ? [] : membersOfGroup(targetGroupKey).map((member) => member.key),
      targetThreadKey,
      newGroupId: randomUUID(),
      newGroupName: suggestGroupName(
        [targetTitle, draggedTitle].flatMap((title) => (title === null ? [] : [title])),
      ),
    };
    const plan = planGroupDrop({ manualGroups, ...drop });
    if (plan === null) return;
    // Replanned against what is stored rather than against the pruned view of
    // it: a group whose environment has not finished loading is missing from
    // that view, and writing it back would delete the group for good.
    setManualGroups(
      (current) => planGroupDrop({ manualGroups: current, ...drop })?.manualGroups ?? current,
    );
    // Dropping a thread into a group is the opposite statement to having taken
    // it out of one, so it clears the removal rather than fighting it.
    setUngroupedThreads((current) => ungroupedKeysWithout(current, [draggedKey]));
    setRenamingGroupKey(plan.renameKey);
  };

  /**
   * Put a group where its row was dropped.
   *
   * Its members carry the order, so the move is theirs: they take consecutive
   * keys at the slot the block landed on, and the ordinary assignment path
   * writes them. One drop, one arrangement, exactly as dragging a thread.
   */
  const moveGroup = (groupItemId: string, overId: string | null, side?: "above" | "below") => {
    if (overId === null) return;
    const memberKeys = groupItemMemberKeys(groupItemId);
    const target = planSidebarGroupMove(sidebarListItems, groupItemId, overId, side);
    if (target === null) return;
    // The same gate `planSidebarThreadDrop` applies to a thread: only rows the
    // user may place take part, and a plan reaching any other row is no plan.
    const writable = activeReorderableThreadKeys;
    if (!memberKeys.every((key) => writable.has(key))) return;
    const orderedIds = target.activeOrder.filter(
      (key) => writable.has(key) || activeKeysById.get(key) != null,
    );
    const keysById = new Map(activeKeysById);
    const assignments: Array<{ readonly id: string; readonly orderKey: string }> = [];
    for (const memberKey of memberKeys) {
      for (const assignment of planPinnedReorder({ orderedIds, keysById, movedId: memberKey })) {
        keysById.set(assignment.id, assignment.orderKey);
        assignments.push(assignment);
      }
    }
    if (assignments.length === 0 || !assignments.every(({ id }) => writable.has(id))) return;
    const assignedKeys = new Map(assignments.map(({ id, orderKey }) => [id, orderKey]));
    if (
      !checkThreadOperations(
        [...assignedKeys.keys()].flatMap((key) => {
          const thread = threadByAnyKey.get(key);
          return thread ? [thread] : [];
        }),
      )
    )
      return;
    const drop = {
      key: memberKeys[0]!,
      sourceSection: "active" as const,
      section: "active" as const,
      occurredAt: new Date().toISOString(),
      clearsSnooze: false,
      order: target.activeOrder,
      keysAtDrop: activeKeysById,
      assignedKeys,
    };
    setOptimisticDrop(drop);
    void (async () => {
      for (const [threadKey, orderKey] of assignedKeys) {
        const thread = threadByAnyKey.get(threadKey);
        if (thread === undefined) continue;
        const result = await reorderActiveThread(
          scopeThreadRef(thread.environmentId, thread.id),
          orderKey,
        );
        if (result._tag === "Success") continue;
        setOptimisticDrop((current) => (current === drop ? null : current));
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to reorder active threads",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }
    })();
  };
  const handleThreadDragEnd = (event: DragEndEvent) => {
    const activeKey = String(event.active.id);
    const joinTargetId = dragState?.joinTargetId ?? null;
    if (joinTargetId !== null) {
      applyGroupDrop(activeKey, joinTargetId);
      return;
    }
    const draggedGroupKey = sidebarGroupKeyFromItemId(activeKey);
    if (draggedGroupKey !== null) {
      // A shelf takes or gives back the whole group, thread by thread: the
      // same thing its row's own Settle and Un-settle do.
      const shelf = dragState?.targetSection;
      const shelved = dragState?.activeSection;
      const members = groupItemMemberKeys(activeKey);
      if (shelf === "settled" || shelf === "pinned") {
        if (shelf === shelved) {
          moveGroup(
            activeKey,
            event.over === null ? null : String(event.over.id),
            dragState?.insertAnchor?.side,
          );
          return;
        }
        if (shelf === "settled") settleThreads(members);
        else pinThreads(members);
        return;
      }
      if (shelved === "settled" || shelved === "pinned") {
        if (shelved === "settled") unsettleThreads(members);
        else unpinThreads(members);
        return;
      }
      moveGroup(
        activeKey,
        event.over === null ? null : String(event.over.id),
        dragState?.insertAnchor?.side,
      );
      return;
    }
    // The gap it was released in says which group it belongs to, the way the
    // rail says which rows are in one: dropped between two of a group's rows
    // it joins them, dropped anywhere else it leaves the group it was in.
    const anchor = dragState?.insertAnchor ?? null;
    const slotGroupKey =
      anchor === null
        ? null
        : groupKeyAtSidebarSlot(
            sidebarListItems,
            anchor,
            activeKey,
            (key) => groupEntryByThreadKey.get(key)?.group.key ?? null,
          );
    const currentGroupKey = groupEntryByThreadKey.get(activeKey)?.group.key ?? null;
    if (slotGroupKey !== null && slotGroupKey !== currentGroupKey) {
      applyGroupDrop(activeKey, sidebarGroupItemId(slotGroupKey));
    } else if (slotGroupKey === null && currentGroupKey !== null) {
      const title = threadByAnyKey.get(activeKey)?.title ?? "";
      setManualGroups((current) => removeFromManualGroups(current, [activeKey]));
      setUngroupedThreads((current) => ungroupedKeysWith(current, [{ key: activeKey, title }]));
    }
    const activeSection = sectionByThreadKey.get(activeKey);
    const target =
      event.over === null
        ? null
        : resolveSidebarDropTarget(
            sidebarListItems,
            activeKey,
            String(event.over.id),
            dragState?.insertAnchor?.side,
          );
    const activeThread = threadByKey.get(activeKey);
    if (activeSection === undefined || target === null || activeThread === undefined) return;
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const plan = planSidebarThreadDrop({
      activeKey,
      activeSection,
      activePinned: activeThread.pinnedAt != null,
      activeSettled: activeThread.settledOverride === "settled",
      supportsSettlement:
        serverConfigs.get(activeThread.environmentId)?.environment.capabilities.threadSettlement ===
        true,
      target,
      pinnedOrder: pinnedKeys,
      pinnedKeysById,
      reorderableKeys: draggableThreadKeys,
      activeOrder: activeKeys,
      activeKeysById,
      activeReorderableKeys: activeReorderableThreadKeys,
      activeTimeOrdered: workingShelfEnabled,
    });
    if (plan.kind === "none") return;
    if (plan.kind === "settle" && settlingThreadKeysRef.current.has(activeKey)) return;
    const assignments =
      plan.kind === "pin"
        ? [
            ...(plan.orderKey === undefined ? [] : [{ id: activeKey, orderKey: plan.orderKey }]),
            ...plan.extraAssignments,
          ]
        : plan.kind === "reorder-pinned" || plan.kind === "move-active"
          ? plan.assignments
          : [];
    if (
      !checkThreadOperations(
        [activeKey, ...assignments.map(({ id }) => id)].flatMap((key) => {
          const thread = threadByAnyKey.get(key);
          return thread ? [thread] : [];
        }),
      )
    )
      return;
    const drop = {
      key: activeKey,
      sourceSection: activeSection,
      section: target.section,
      occurredAt: new Date().toISOString(),
      clearsSnooze:
        plan.kind === "pin" ||
        plan.kind === "settle" ||
        (plan.kind === "move-active" && plan.unsnooze),
      order: plan.kind === "settle" ? null : plan.order,
      keysAtDrop: target.section === "active" ? activeKeysById : pinnedKeysById,
      assignedKeys: new Map(assignments.map(({ id, orderKey }) => [id, orderKey])),
    };
    setOptimisticDrop(drop);
    void (async () => {
      const run = async (
        operation: Promise<AtomCommandResult<unknown, unknown>>,
        title: string,
      ) => {
        const result = await operation;
        if (result._tag === "Success") return true;
        setOptimisticDrop((current) => (current === drop ? null : current));
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title,
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return false;
      };
      switch (plan.kind) {
        case "settle": {
          settlingThreadKeysRef.current.add(activeKey);
          const navigateAfterSettle = planForwardNavigation(activeKey);
          const settled = await run(settleThread(threadRef), "Failed to settle thread").finally(
            () => settlingThreadKeysRef.current.delete(activeKey),
          );
          if (
            settled &&
            shouldNavigateAfterThreadPark({
              threadKey: activeKey,
              currentThreadKey: routeThreadKeyRef.current,
              action: "settle",
              now: new Date().toISOString(),
              thread: readThreadShell(threadRef),
            })
          )
            navigateAfterSettle?.();
          return;
        }
        case "move-active":
          if (plan.unpin && !(await run(unpinThread(threadRef), "Failed to unpin thread"))) return;
          if (
            plan.unsettle &&
            !(await run(unsettleThread(threadRef), "Failed to un-settle thread"))
          )
            return;
          if (plan.unsnooze && !(await run(unsnoozeThread(threadRef), "Failed to wake thread")))
            return;
          break;
        case "pin":
          if (
            !(await run(
              pinThread(threadRef, plan.orderKey === undefined ? {} : { orderKey: plan.orderKey }),
              "Failed to pin thread",
            ))
          )
            return;
          break;
        case "reorder-pinned":
          break;
      }
      const keyWrites = plan.kind === "pin" ? plan.extraAssignments : plan.assignments;
      for (const assignment of keyWrites) {
        const thread = threadByAnyKey.get(assignment.id);
        if (thread === undefined) continue;
        if (
          !(await run(
            (plan.kind === "move-active" ? reorderActiveThread : reorderPinnedThread)(
              scopeThreadRef(thread.environmentId, thread.id),
              assignment.orderKey,
            ),
            plan.kind === "move-active"
              ? "Failed to reorder active threads"
              : "Failed to reorder pinned threads",
          ))
        )
          return;
      }
    })();
  };
  const performSnooze = async (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
  ) => {
    const threadKey = scopedThreadKey(threadRef);
    if (snoozingThreadKeysRef.current.has(threadKey)) {
      return { status: "skipped" } as const;
    }
    snoozingThreadKeysRef.current.add(threadKey);
    const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
    const result = await snoozeThread(threadRef, preset.snoozedUntil);
    snoozingThreadKeysRef.current.delete(threadKey);
    if (result._tag === "Failure") {
      return isAtomCommandInterrupted(result)
        ? ({ status: "interrupted" } as const)
        : ({ status: "failure", error: squashAtomCommandFailure(result) } as const);
    }
    if (
      shouldNavigateAfterThreadPark({
        threadKey,
        currentThreadKey: routeThreadKeyRef.current,
        action: "snooze",
        now: new Date().toISOString(),
        thread: readThreadShell(threadRef),
      })
    ) {
      navigateAfterSnooze?.();
    }
    return { status: "success" } as const;
  };
  const attemptSnooze = (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
    opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
  ) => {
    void (async () => {
      const outcome = await performSnooze(threadRef, preset, opts);
      if (outcome.status === "failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to snooze thread",
            description:
              outcome.error instanceof Error ? outcome.error.message : "An error occurred.",
          }),
        );
        return;
      }
    })();
  };
  const snoozeThreads = (
    threadKeys: readonly string[],
    preset: Pick<SnoozePreset, "snoozedUntil">,
  ) => {
    const coSnoozingKeys = new Set(threadKeys);
    for (const threadKey of threadKeys) {
      // By any key, like its siblings: the rows a fold hides are the whole of
      // what a folded group's own Snooze is asked to reach.
      const thread = threadByAnyKey.get(threadKey);
      if (!thread) continue;
      attemptSnooze(scopeThreadRef(thread.environmentId, thread.id), preset, { coSnoozingKeys });
    }
  };

  const handleMultiSelectContextMenu = useStableCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const selectedThreadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      const threadKeys = selectedThreadKeys.filter((threadKey) =>
        threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      const selectionNow = new Date();
      const selectedThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const settlingThreads = selectedThreads.filter(
        (thread) => thread.settledOverride !== "settled",
      );
      const canSnoozeSelection = selectedThreads.every(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: selectionNow.toISOString() }),
      );
      const titleRegenerationThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true,
      );
      const regeneratableTitleThreads = titleRegenerationThreads.filter(
        (thread) => thread.titleRegeneration == null,
      );
      const titleRegenerationMenuItem = buildBulkTitleRegenerationContextMenuItem({
        supportedCount: titleRegenerationThreads.length,
        actionableCount: regeneratableTitleThreads.length,
      });
      const pinnedSelectedThreads = selectedThreads.filter(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinning ===
            true && thread.pinnedAt != null,
      );
      const unpinMenuItem = buildBulkUnpinContextMenuItem({
        pinnedCount: pinnedSelectedThreads.length,
      });
      const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            ...(unpinMenuItem
              ? [{ ...unpinMenuItem, disabled: !canOperateThreads(pinnedSelectedThreads) }]
              : []),
            {
              id: "settle",
              label: `Settle (${count})`,
              disabled: settlingThreads.length === 0 || !canOperateThreads(settlingThreads),
            },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    disabled: !canOperateThreads(selectedThreads),
                    children: [
                      ...snoozePresets.map((preset) => ({
                        id: `snooze:${preset.id}`,
                        label: `${preset.label} (${preset.whenLabel})`,
                        disabled: !canOperateThreads(selectedThreads),
                      })),
                      {
                        id: "snooze:custom",
                        label: "Custom…",
                        separatorBefore: true,
                        disabled: !canOperateThreads(selectedThreads),
                      },
                    ],
                  },
                ]
              : []),
            ...(titleRegenerationMenuItem
              ? [
                  {
                    ...titleRegenerationMenuItem,
                    disabled:
                      titleRegenerationMenuItem.disabled ||
                      !canOperateThreads(regeneratableTitleThreads),
                  },
                ]
              : []),
            ...(count > 1
              ? [{ id: "group", label: `Group (${count})`, separatorBefore: true }]
              : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            {
              id: "delete",
              label: `Delete (${count})`,
              destructive: true,
              disabled: !canOperateThreads(selectedThreads),
            },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure" || clicked.value === null) return;
      // Grouping is a local arrangement, so it skips the operate-scope gate
      // the server-side actions below go through.
      if (clicked.value === "group") {
        const id = randomUUID();
        setManualGroups((current) =>
          addManualGroup(current, {
            id,
            name: suggestGroupName(selectedThreads.map((thread) => thread.title)),
            members: threadKeys,
          }),
        );
        setUngroupedThreads((current) => ungroupedKeysWithout(current, threadKeys));
        clearSelection();
        setRenamingGroupKey(manualGroupKey(id));
        return;
      }
      const actionTargets =
        clicked.value === "unpin"
          ? pinnedSelectedThreads
          : clicked.value === "regenerate-title"
            ? regeneratableTitleThreads
            : clicked.value === "settle"
              ? settlingThreads.flatMap((thread) => {
                  const current = threadByKeyRef.current.get(
                    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
                  );
                  return current && current.settledOverride !== "settled" ? [current] : [];
                })
              : selectedThreads;
      if (clicked.value === "settle" && actionTargets.length === 0) return;
      if (clicked.value !== "mark-unread" && !checkThreadOperations(actionTargets)) return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset =
          clicked.value === "snooze:custom"
            ? await requestCustomSnooze()
            : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
        if (preset) {
          const coSnoozingKeys = new Set(threadKeys);
          clearSelection();
          const outcomes = await Promise.all(
            selectedThreads.map(async (thread) => {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const outcome = await performSnooze(threadRef, preset, { coSnoozingKeys });
              return { outcome, threadRef };
            }),
          );
          const snoozedThreadRefs = outcomes.flatMap(({ outcome, threadRef }) =>
            outcome.status === "success" ? [threadRef] : [],
          );
          const failures = outcomes.flatMap(({ outcome }) =>
            outcome.status === "failure" ? [outcome.error] : [],
          );

          if (failures.length > 0) {
            const firstError = failures[0];
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title:
                  snoozedThreadRefs.length > 0
                    ? `Failed to snooze ${failures.length} thread${failures.length === 1 ? "" : "s"}`
                    : "Failed to snooze threads",
                description:
                  firstError instanceof Error ? firstError.message : "An error occurred.",
              }),
            );
          }
        }
        return;
      }
      if (clicked.value === "unpin") {
        for (const thread of pinnedSelectedThreads) {
          attemptUnpin(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value === "regenerate-title") {
        for (const thread of regeneratableTitleThreads) {
          const result = await updateThreadMetadata({
            environmentId: thread.environmentId,
            input: { threadId: thread.id, regenerateTitle: true },
          });
          if (result._tag === "Success") continue;
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to regenerate thread titles",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        clearSelection();
        return;
      }
      if (clicked.value === "settle") {
        settleThreads(
          actionTargets.map((thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
          ),
        );
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          if (thread) markThreadUnread(scopeThreadRef(thread.environmentId, thread.id));
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      if (confirmThreadDelete) {
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            [
              `Delete ${count} thread${count === 1 ? "" : "s"}?`,
              "This permanently clears conversation history for these threads.",
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      if (
        !checkThreadOperations(
          threadKeys.flatMap((threadKey) => {
            const thread = threadByKeyRef.current.get(threadKey);
            return thread ? [thread] : [];
          }),
        )
      )
        return;
      const { deletedThreadKeys, firstFailure } = await deleteSelectedThreadEntries({
        entries: threadKeys.map((threadKey) => ({ threadKey })),
        delete: async ({ threadKey }, deletedThreadKeys) => {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread) return null;
          return deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
            deletedThreadKeys,
          });
        },
      });
      if (firstFailure !== null) {
        const firstError = squashAtomCommandFailure(firstFailure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete threads",
            description: firstError instanceof Error ? firstError.message : "An error occurred.",
          }),
        );
      }
      removeFromSelection(
        getThreadKeysToDeselectAfterDelete(selectedThreadKeys, deletedThreadKeys, (threadKey) => {
          const threadRef = parseScopedThreadKey(threadKey);
          return threadRef !== null && readThreadShell(threadRef) !== null;
        }),
      );
    },
  );

  const handleDraftContextMenu = useStableCallback(
    (draftId: DraftId, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        const session = useComposerDraftStore.getState().getDraftSession(draftId);
        if (!api || !session || session.promotedTo) return;
        const projectGroup = projectGroupsRef.current.find((group) =>
          group.memberProjectRefs.some(
            (ref) =>
              ref.environmentId === session.environmentId && ref.projectId === session.projectId,
          ),
        );
        const workspacePath =
          session.worktreePath ??
          projectByKey.get(`${session.environmentId}:${session.projectId}`)?.workspaceRoot;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildDraftActionMenuItems({
              hasPath: Boolean(workspacePath),
              hasBranch: Boolean(session.branch),
              hasProject: projectGroup != null,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "project-settings":
            if (projectGroup)
              openProjectSettings(projectGroup, {
                environmentId: session.environmentId,
                projectId: session.projectId,
              });
            return;
          case "copy-path":
            if (workspacePath) copyPathToClipboard(workspacePath, { path: workspacePath });
            return;
          case "copy-branch":
            if (session.branch) copyBranchToClipboard(session.branch, { branch: session.branch });
            return;
          case "discard": {
            // The menu can stay open while the draft sends; discarding a
            // promoting draft would strand the send.
            const current = useComposerDraftStore.getState().getDraftSession(draftId);
            if (current && !current.promotedTo) discardComposerDraft(draftId);
            return;
          }
        }
      })();
    },
  );

  const handleCommitGroupRename = useStableCallback((groupKey: string, name: string) => {
    setManualGroups((current) => renameManualGroup(current, groupKey, name));
    setRenamingGroupKey(null);
  });
  const handleCancelGroupRename = useStableCallback(() => setRenamingGroupKey(null));

  const handleGroupContextMenu = useStableCallback(
    (groupKey: string, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const members = membersOfGroup(groupKey);
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              { id: "rename", label: "Rename group" },
              { id: "ungroup", label: "Ungroup", destructive: true },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        if (clicked.value === "rename") {
          // A group read off the titles has no name of its own to change, so
          // renaming it is where it becomes one of yours — the same conversion
          // a drop onto it performs, under the name it already had.
          if (manualGroupNameOf(manualGroupsRef.current, groupKey) === null) {
            const id = randomUUID();
            setManualGroups((current) =>
              addManualGroup(current, {
                id,
                name: groupKey,
                members: members.map((member) => member.key),
              }),
            );
            setRenamingGroupKey(manualGroupKey(id));
            return;
          }
          setRenamingGroupKey(groupKey);
        }
        if (clicked.value === "ungroup") {
          // Both halves, whichever kind of group this is: the membership goes,
          // and the titles that would re-form the group are refused. Without
          // the second, taking apart a group built around a ticket lasted
          // exactly as long as the next render.
          setManualGroups((current) => dropManualGroup(current, groupKey));
          setUngroupedThreads((current) => ungroupedKeysWith(current, members));
        }
      })();
    },
  );

  const handleThreadContextMenu = useStableCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        const threadWorkspacePath =
          thread.worktreePath ??
          projectByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot ??
          null;
        const supportsSettlement =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSettlement ===
          true;
        const supportsSnooze =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
        const supportsPinning =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadPinning === true;
        const supportsAutoSettleOptOut =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadAutoSettleOptOut === true;
        const supportsTitleRegeneration =
          serverConfigs.get(thread.environmentId)?.environment.capabilities
            .threadTitleRegeneration === true;
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const isSettled = settledThreadKeysRef.current.has(threadKey);
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        const isPinned = thread.pinnedAt != null;
        const snoozePresets = resolveSnoozePresets(new Date(), timestampFormat);
        const threadProjectGroup =
          projectGroupsRef.current.find((project) =>
            project.memberProjectRefs.some(
              (projectRef) =>
                projectRef.environmentId === thread.environmentId &&
                projectRef.projectId === thread.projectId,
            ),
          ) ?? null;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            buildThreadActionMenuItems({
              canOperate: readEnvironmentScope(
                threadRef.environmentId,
                AuthOrchestrationOperateScope,
              ),
              branch: thread.branch ?? null,
              projectFilter: threadProjectGroup
                ? {
                    label: threadProjectGroup.displayName,
                    isActive: projectScopeKey === threadProjectGroup.projectKey,
                  }
                : null,
              isPinned,
              // A group that is on screen, which a lone thread whose title
              // names a ticket is not: nothing would be left to leave.
              inGroup: liveGroupKeys.has(groupKeyOf(thread) ?? ""),
              isSettled,
              autoSettleEnabled: thread.autoSettleDisabledAt == null,
              isSnoozed,
              canSnoozeNow: canSnooze(thread, { now: new Date().toISOString() }),
              isRegeneratingTitle,
              isRunning: !threadRuntimeCanArchive(thread.runtime),
              supports: {
                settlement: supportsSettlement,
                autoSettleOptOut: supportsAutoSettleOptOut,
                snooze: supportsSnooze,
                pinning: supportsPinning,
                titleRegeneration: supportsTitleRegeneration,
              },
              snoozePresets,
            }),
            position,
          ),
        );
        if (clicked._tag === "Failure" || clicked.value === null) return;
        if (threadActionRequiresOperate(clicked.value) && !checkThreadOperations([thread])) return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset =
            clicked.value === "snooze:custom"
              ? await requestCustomSnooze()
              : snoozePresets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        switch (clicked.value) {
          case "filter-by-project":
            if (threadProjectGroup) {
              setProjectScopeKey(
                projectScopeKey === threadProjectGroup.projectKey
                  ? null
                  : threadProjectGroup.projectKey,
              );
            }
            return;
          case "project-settings":
            if (threadProjectGroup)
              openProjectSettings(threadProjectGroup, {
                environmentId: threadRef.environmentId,
                projectId: thread.projectId,
              });
            return;
          case "new-thread-on-branch": {
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "remove-from-group":
            setManualGroups((current) => removeFromManualGroups(current, [threadKey]));
            setUngroupedThreads((current) =>
              ungroupedKeysWith(current, [{ key: threadKey, title: thread.title }]),
            );
            return;
          case "settle":
            attemptSettle(threadRef);
            return;
          case "unsettle":
            attemptUnsettle(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "pin":
            attemptPin(threadRef);
            return;
          case "unpin":
            attemptUnpin(threadRef);
            return;
          case "auto-settle:enabled":
          case "auto-settle:disabled": {
            const result = await setThreadAutoSettle(
              threadRef,
              clicked.value === "auto-settle:enabled",
            );
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to update auto-settle",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "regenerate-title": {
            if (isRegeneratingTitle) return;
            const result = await updateThreadMetadata({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, regenerateTitle: true },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to regenerate thread title",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "mark-unread":
            markThreadUnread(threadRef);
            return;
          case "copy-path":
            if (!threadWorkspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Path unavailable",
                  description: "This thread does not have a workspace path to copy.",
                }),
              );
              return;
            }
            copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
            return;
          case "copy-branch":
            if (thread.branch) {
              copyBranchToClipboard(thread.branch, { branch: thread.branch });
            }
            return;
          case "copy-thread-id":
            copyThreadIdToClipboard(thread.id, { threadId: thread.id });
            return;
          case "archive": {
            if (confirmThreadArchive) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(`Archive thread "${thread.title}"?`),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            let didArchive = false;
            const result = await archiveThread(threadRef, {
              onArchived: () => {
                didArchive = true;
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: didArchive
                    ? "Thread archived, but navigation failed"
                    : "Failed to archive thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          case "delete": {
            if (confirmThreadDelete) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(
                  [
                    `Delete thread "${thread.title}"?`,
                    "This permanently clears conversation history for this thread.",
                  ].join("\n"),
                  { variant: "destructive" },
                ),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            const result = await deleteThread(threadRef);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to delete thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          default:
            return;
        }
      })();
    },
  );

  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
          isWeb: !isElectron,
          isDesktop: isElectron,
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeRowThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeRowThreadKey,
    routeTerminalOpen,
    threadByKey,
  ]);

  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    {
      platform: navigator.platform,
      context: {
        terminalFocus: terminalFocused,
        terminalOpen: routeTerminalOpen,
        modelPickerOpen: isModelPickerOpen(),
        isWeb: !isElectron,
        isDesktop: isElectron,
      },
    },
  );
  useEffect(() => {
    updateThreadJumpHintsVisibility(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow, updateThreadJumpHintsVisibility]);

  const handleNewThreadClick = (event?: ReactMouseEvent) => {
    if (shouldCreateNewThreadInCurrentProject(event?.shiftKey ?? false, projectGroups.length)) {
      if (isMobile) setOpenMobile(false);
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-thread-in" });
  };

  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    (projectGroups.length <= 1 ? shortcutLabelForCommand(keybindings, "chat.newLocal") : undefined);
  const newThreadInProjectShortcutLabel = shortcutLabelForCommand(keybindings, "chat.newLocal");
  return (
    <>
      <ThreadContextDragGhost />
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <SidebarThreadHeader
              searchFieldRef={headerSearchRef}
              hasProjects={projectGroups.length > 0}
              projectScope={
                <Combobox
                  items={projectScopeItems}
                  filteredItems={filteredProjectScopeItems}
                  autoHighlight
                  itemToStringLabel={(item) => item.label}
                  isItemEqualToValue={(a, b) => a.value === b.value}
                  open={projectScopeMenuState.open}
                  onOpenChange={(open) => {
                    if (open) suppressNextScopeChangeRef.current = false;
                    dispatchProjectScopeMenu({ type: "open-changed", open });
                  }}
                  onItemHighlighted={(item) => {
                    highlightedProjectScopeKeyRef.current = item?.value ?? null;
                  }}
                  value={selectedProjectScopeItem}
                  onValueChange={(item) => {
                    if (suppressNextScopeChangeRef.current) {
                      suppressNextScopeChangeRef.current = false;
                      return;
                    }
                    if (!item) return;
                    setProjectScopeKey(item.value === "all" ? null : item.value);
                  }}
                >
                  <ComboboxTrigger
                    render={
                      <SidebarHeaderIconButton
                        label={
                          scopedProjectGroup
                            ? `Filter threads by project: ${scopedProjectGroup.displayName}`
                            : "Filter threads by project"
                        }
                      />
                    }
                  >
                    {scopedProjectGroup ? (
                      <span className="flex shrink-0">
                        <ProjectFavicon project={scopedProjectGroup} className="size-4" />
                      </span>
                    ) : (
                      <ListFilterIcon className="size-4" />
                    )}
                  </ComboboxTrigger>
                  <ComboboxPopup
                    align="start"
                    anchor={headerSearchRef}
                    className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
                  >
                    <ComboboxSearchInput
                      aria-label="Search projects"
                      placeholder="Search projects..."
                      value={projectScopeMenuState.query}
                      onKeyDown={(event) => {
                        if (
                          event.defaultPrevented ||
                          event.nativeEvent.isComposing ||
                          event.ctrlKey ||
                          event.altKey ||
                          event.metaKey ||
                          (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                        ) {
                          return;
                        }
                        const scopeKey = highlightedProjectScopeKeyRef.current;
                        const project = scopeKey ? projectGroupByScopeKey.get(scopeKey) : null;
                        if (project) handleProjectSettings(event, project);
                      }}
                      onChange={(event) =>
                        dispatchProjectScopeMenu({
                          type: "query-changed",
                          query: event.target.value,
                        })
                      }
                    />
                    <ComboboxEmpty>No matching projects.</ComboboxEmpty>
                    <ComboboxList>
                      {(item: (typeof projectScopeItems)[number]) => {
                        const project = projectGroupByScopeKey.get(item.value) ?? null;
                        return (
                          <ComboboxItem
                            key={item.value}
                            hideIndicator
                            value={item}
                            onContextMenu={(event) => {
                              if (project) handleProjectSettings(event, project);
                            }}
                          >
                            {project ? (
                              <ProjectFavicon project={project} className="size-4 shrink-0" />
                            ) : (
                              <FolderIcon className="size-4 shrink-0" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                            {project && showProjectEnvironments ? (
                              <ProjectEnvironmentBadge
                                group={project}
                                primaryEnvironmentId={primaryEnvironmentId}
                                machineByEnvironmentId={environmentMachineById}
                              />
                            ) : null}
                            {project ? (
                              <Button
                                size="icon-xs"
                                variant="ghost-muted"
                                tabIndex={-1}
                                aria-hidden="true"
                                title={`Project settings for ${project.displayName}`}
                                className="ml-auto"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  void handleProjectSettings(event, project);
                                }}
                              >
                                <SettingsIcon className="size-3.5" />
                              </Button>
                            ) : null}
                          </ComboboxItem>
                        );
                      }}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              }
              onNewProject={openAddProjectCommandPalette}
              onNewThread={handleNewThreadClick}
              newThreadDisabled={projects.length === 0}
              newThreadShortcutLabel={newThreadShortcutLabel}
              newThreadInProjectShortcutLabel={newThreadInProjectShortcutLabel}
              showNewThreadInProjectHint={projectGroups.length > 1}
              searchInputRef={threadSearchInputRef}
              searchQuery={threadSearchQuery}
              onSearchQueryChange={(value) => {
                setThreadSearchQuery(value);
                setActiveSearchResultIndex(0);
              }}
              onSearchKeyDown={handleThreadSearchKeyDown}
              isSearching={isSearchingThreads}
              searchResultCount={threadSearchResults.length}
              activeSearchResultIndex={activeSearchResultIndex}
              onClearSearch={clearThreadSearch}
            />
          </SidebarGroup>
        }
      >
        <SidebarGroup className="flex-1" role="presentation">
          {isSearchingThreads ? (
            threadSearchResults.length > 0 ? (
              <TooltipProvider
                key="sidebar-thread-search-tooltips-150"
                delay={150}
                closeDelay={0}
                timeout={400}
              >
                <ul
                  id="sidebar-thread-search-results"
                  role="listbox"
                  aria-label="Thread search results"
                  className="flex flex-col gap-px"
                >
                  {threadSearchResults.map((thread, index) => {
                    const threadKey = scopedThreadKey(
                      scopeThreadRef(thread.environmentId, thread.id),
                    );
                    return (
                      <SidebarSearchResultRow
                        isSettled={settledThreadKeys.has(threadKey)}
                        key={threadKey}
                        thread={thread}
                        project={
                          projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                        projectDisplayName={
                          projectDisplayNameByKey.get(
                            `${thread.environmentId}:${thread.projectId}`,
                          ) ?? null
                        }
                        environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                        environmentMachine={
                          environmentMachineById.get(thread.environmentId) ?? "server"
                        }
                        providerEntryByInstanceId={
                          providerEntriesByEnvironment.get(thread.environmentId) ??
                          EMPTY_PROVIDER_ENTRIES
                        }
                        isHighlighted={activeSearchResultIndex === index}
                        isRouteActive={routeRowThreadKey === threadKey}
                        resultId={`sidebar-thread-search-result-${index}`}
                        searchMatch={
                          threadSearchMatchByKey.get(
                            threadSearchMatchKey({
                              environmentId: thread.environmentId,
                              threadId: thread.id,
                            }),
                          ) ?? null
                        }
                        searchQuery={threadSearchQuery}
                        onHighlight={() => setActiveSearchResultIndex(index)}
                        onSelect={() => selectThreadSearchResult(thread)}
                        onFileDropThreads={handleThreadFileDrop}
                      />
                    );
                  })}
                </ul>
              </TooltipProvider>
            ) : (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                {threadSearch.isPending ? "Searching thread messages…" : "No threads found"}
              </p>
            )
          ) : null}
          {!isSearchingThreads ? (
            <TooltipProvider
              key="sidebar-thread-tooltips-150"
              delay={150}
              closeDelay={0}
              timeout={400}
            >
              <DndContext
                sensors={dndSensors}
                // Vertical only: a card carried sideways would otherwise scroll
                // the list under itself, and every position read goes with it.
                autoScroll={isContextDrag ? false : SIDEBAR_AUTO_SCROLL}
                collisionDetection={dndCollisionDetection}
                modifiers={dndModifiers}
                onDragStart={handleThreadDragStart}
                onDragOver={handleThreadDragOver}
                onDragMove={handleThreadDragOver}
                onDragEnd={handleThreadDragEnd}
              >
                <SidebarDragLifecycle onUnmount={cancelThreadDrag} />
                <SortableContext items={sortableIds} strategy={sidebarRowsStayPut}>
                  <ul
                    ref={attachListMotionRef}
                    // VoiceOver treats an exposed list as an interaction boundary,
                    // which hides its rows from ordinary linear navigation. A
                    // presentational list also makes its implicit listitems
                    // presentational while preserving every descendant control.
                    role="presentation"
                    className={cn(
                      "relative flex flex-col gap-px",
                      sidebarListItems.length > 0 && "flex-1",
                      actionSweep !== null && "**:pointer-events-none",
                      // A drag is not a hover: the sensor tracks the pointer
                      // on the document, so taking the rows out of pointer
                      // events costs the gesture nothing and stops hover cards
                      // and tooltips from opening under the row being dragged.
                      dragState !== null && "**:pointer-events-none",
                    )}
                  >
                    {(() => {
                      const renderThreadRow = (
                        thread: EnvironmentThreadShell,
                        section: SidebarSection,
                      ) => {
                        const threadKey = scopedThreadKey(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        const isCard =
                          section === "active" || section === "pinned" || section === "working";
                        const rowVariant = isCard ? "card" : "slim";
                        // Both primitives, so a row that is not in a group
                        // keeps a stable undefined and its memo survives
                        // streamed events.
                        const groupEntry = groupEntryByThreadKey.get(threadKey);
                        return (
                          <SortableThreadRow
                            key={threadKey}
                            sortableId={threadKey}
                            contextDrag={isContextDrag}
                            sortableDisabled={
                              renamingThreadKey === threadKey ||
                              !draggableThreadKeys.has(threadKey) ||
                              optimisticDrop !== null
                            }
                            thread={thread}
                            groupName={groupEntry?.group.name}
                            isGroupEnd={groupEntry?.isGroupEnd}
                            variant={rowVariant}
                            variantAction={
                              section === "snoozed"
                                ? "unsnooze"
                                : section === "settled"
                                  ? "unsettle"
                                  : "settle"
                            }
                            settlementSupported={
                              serverConfigs.get(thread.environmentId)?.environment.capabilities
                                .threadSettlement === true
                            }
                            snoozeSupported={
                              serverConfigs.get(thread.environmentId)?.environment.capabilities
                                .threadSnooze === true
                            }
                            pinningSupported={
                              serverConfigs.get(thread.environmentId)?.environment.capabilities
                                .threadPinning === true
                            }
                            isPinned={thread.pinnedAt != null}
                            dropVerb={
                              dragState?.activeKey === threadKey
                                ? resolveSidebarDropVerb(dragState.activeSection, dragTargetSection)
                                : null
                            }
                            dragOverPinned={
                              dragState?.activeKey === threadKey && dragTargetSection === "pinned"
                            }
                            isJoinTarget={dragState?.joinTargetId === threadKey}
                            sweepAction={
                              actionSweep?.keys.has(threadKey) ? actionSweep.action : null
                            }
                            snoozeWakeLabelText={
                              section === "snoozed" && thread.snoozedUntil != null
                                ? snoozeWakeLabel(thread.snoozedUntil, {
                                    now: new Date().toISOString(),
                                  })
                                : null
                            }
                            wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                            isActive={routeRowThreadKey === threadKey}
                            isRouteThread={routeThreadKey === threadKey}
                            openPullRequestsInRightPanel={routeThreadRef !== null}
                            jumpLabel={
                              showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null
                            }
                            currentEnvironmentId={primaryEnvironmentId}
                            environmentLabel={
                              environmentLabelById.get(thread.environmentId) ?? null
                            }
                            environmentMachine={
                              environmentMachineById.get(thread.environmentId) ?? "server"
                            }
                            scratchMachineLabel={scratchMachineLabelFor(thread)}
                            project={
                              projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
                              null
                            }
                            projectDisplayName={
                              projectDisplayNameByKey.get(
                                `${thread.environmentId}:${thread.projectId}`,
                              ) ?? null
                            }
                            providerEntryByInstanceId={
                              providerEntriesByEnvironment.get(thread.environmentId) ??
                              EMPTY_PROVIDER_ENTRIES
                            }
                            timestampFormat={timestampFormat}
                            onThreadClick={handleThreadClick}
                            onThreadActivate={navigateToThread}
                            onStartRename={startThreadRename}
                            onRenameTitleChange={setRenamingTitle}
                            onCommitRename={commitThreadRename}
                            onCancelRename={cancelThreadRename}
                            isRenaming={renamingThreadKey === threadKey}
                            renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                            onContextMenu={handleThreadContextMenu}
                            onSettle={attemptSettle}
                            onActionSweepStart={startActionSweep}
                            onUnsettle={attemptUnsettle}
                            onSnooze={attemptSnooze}
                            onUnsnooze={attemptUnsnooze}
                            onUnpin={attemptUnpin}
                            onAcknowledgeWoke={acknowledgeWoke}
                            onFileDropThreads={handleThreadFileDrop}
                          />
                        );
                      };
                      const from = isContextDrag ? null : (dragState?.activeSection ?? null);
                      const items: ReactNode[] = [
                        <SidebarDraftBlock
                          key="draft-sessions"
                          projectByKey={projectByKey}
                          projectDisplayNameByKey={projectDisplayNameByKey}
                          scopedProjectKeys={scopedProjectKeys}
                          routeDraftId={routeDraftIdForRows}
                          onNavigateToDraft={navigateToDraft}
                          onDraftContextMenu={handleDraftContextMenu}
                        />,
                      ];
                      const anchor = dragState?.insertAnchor ?? null;
                      // An empty shelf has its own placeholder to offer; a
                      // shelf that holds something has the well below its
                      // header, whether or not it is folded over its rows.
                      const settledHint = from !== null && settledThreads.length === 0;
                      // The whole list opens at once, and then nothing moves:
                      // every interstice is there from the first move, and the
                      // hand only changes which one is lit. A zone that opens
                      // as it is reached displaces the rows under the hand,
                      // which is the row a gesture skips.
                      //
                      // A boundary is one zone, not two: the slot below a row
                      // and the slot above the next are the same place, and
                      // either name may reach it.
                      const dropZone = (slots: ReadonlyArray<SidebarDropSlot>) => {
                        if (from === null) return null;
                        const lit =
                          anchor !== null &&
                          slots.some((slot) => slot.id === anchor.id && slot.side === anchor.side);
                        return (
                          <SidebarDropZone
                            key={`drop:${slots[0]!.side}:${slots[0]!.id}`}
                            label={lit ? "Move here" : ""}
                            open
                            isDropTarget={lit}
                          />
                        );
                      };
                      // What the next zone owes, from whichever rows it falls
                      // between. A zone is only laid down when something with
                      // a height follows it: the row being carried has given
                      // up its own, so the slots on either side of it are one
                      // place, and a shelf's well already stands where its
                      // first row's would.
                      let owed: SidebarDropSlot[] = [];
                      let absorbed = false;
                      const layZone = () => {
                        const slots = owed;
                        owed = [];
                        // A marker between a shelf's well and its first row —
                        // the empty-section placeholder — owes nothing, and
                        // must not spend the absorption meant for that row.
                        if (slots.length === 0) return null;
                        if (absorbed) {
                          absorbed = false;
                          return null;
                        }
                        return dropZone(slots);
                      };
                      // Only where an order exists. A settled or snoozed row
                      // sits where its shelf puts it — by the hour it was
                      // settled, by the hour it wakes — so there is nothing to
                      // slide between: the shelf's own well is the only answer
                      // a drop gets there.
                      const sortable = (section: SidebarSection) =>
                        section === "pinned" || section === "active" || section === "working";
                      for (const [index, item] of sidebarListItems.entries()) {
                        const nextItem = sidebarListItems[index + 1];
                        const endsRun =
                          nextItem === undefined ||
                          nextItem.kind === "marker" ||
                          !sortable(nextItem.section);
                        if (item.kind === "thread" && !sortable(item.section)) {
                          items.push(renderThreadRow(threadByKey.get(item.key)!, item.section));
                          continue;
                        }
                        if (item.kind === "thread") {
                          owed.push({ id: item.key, side: "above" });
                          const carried = item.key === dragState?.activeKey;
                          items.push(
                            carried ? null : layZone(),
                            renderThreadRow(threadByKey.get(item.key)!, item.section),
                          );
                          owed.push({ id: item.key, side: "below" });
                          if (endsRun) items.push(layZone());
                          continue;
                        }
                        if (item.kind === "group") {
                          const group = groupByKey.get(groupShelfKey(item.groupKey, item.section));
                          if (group !== undefined) {
                            const groupId = sidebarGroupItemId(group.key, item.section);
                            const slotted = sortable(item.section);
                            if (slotted) owed.push({ id: groupId, side: "above" });
                            const carried = groupId === dragState?.activeKey;
                            items.push(
                              carried || !slotted ? null : layZone(),
                              <SidebarGroupHeader
                                key={`group:${item.section}:${item.groupKey}`}
                                itemId={groupId}
                                groupKey={group.key}
                                name={group.name}
                                size={group.size}
                                expanded={!group.collapsed}
                                members={
                                  groupMembersByKey.get(groupShelfKey(group.key, item.section)) ??
                                  EMPTY_GROUP_MEMBERS
                                }
                                onToggle={(key) =>
                                  toggleGroup(
                                    item.section === "active" || item.section === "working"
                                      ? key
                                      : `${item.section}:${key}`,
                                  )
                                }
                                renaming={renamingGroupKey === group.key}
                                onCommitRename={handleCommitGroupRename}
                                onCancelRename={handleCancelGroupRename}
                                onContextMenu={handleGroupContextMenu}
                                onSettleThreads={settleThreads}
                                onUnsettleThreads={unsettleThreads}
                                onSnoozeThreads={snoozeThreads}
                                timestampFormat={timestampFormat}
                                // With the Working shelf on, the inbox is
                                // ordered by return time and a hand-placed row
                                // is ignored, so there is nothing to drag for.
                                // Off the inbox, the gesture is the shelf's
                                // own: carrying the group back out of Pinned
                                // unpins it, out of Settled un-settles it.
                                draggable={
                                  item.section === "pinned" || item.section === "settled"
                                    ? true
                                    : !workingShelfEnabled &&
                                      (
                                        groupMembersByKey.get(
                                          groupShelfKey(group.key, item.section),
                                        ) ?? []
                                      ).every((member) =>
                                        activeReorderableThreadKeys.has(member.key),
                                      )
                                }
                                isJoinTarget={dragState?.joinTargetId === groupId}
                                // Folded over the open thread, so this row is
                                // the one standing in for it.
                                isActive={
                                  routeRowThreadKey !== null &&
                                  groupEntryByThreadKey.get(routeRowThreadKey)?.group.key ===
                                    group.key &&
                                  sectionByThreadKey.get(routeRowThreadKey) === item.section
                                }
                              />,
                            );
                            if (slotted) owed.push({ id: groupId, side: "below" });
                            if (endsRun && slotted) items.push(layZone());
                          }
                          continue;
                        }
                        items.push(layZone());
                        switch (item.marker) {
                          case "pinned-header":
                            items.push(
                              <SidebarDragBoundary
                                key="pinned-header"
                                marker="pinned-header"
                                label="Pinned"
                                visible={from !== null}
                                isDropTarget={dragTargetSection === "pinned"}
                              />,
                              // Pinned receives a row the way Settled does, and
                              // says so in the same words.
                              <SidebarDropZone
                                key="pinned-drop"
                                testId="sidebar-pinned-drop"
                                label="Pin here"
                                // The shelf has no rows of its own to drop
                                // between, so its zone stands in for them.
                                open={from !== null && pinnedThreads.length === 0}
                                isDropTarget={dragTargetSection === "pinned"}
                              />,
                            );
                            absorbed = from !== null && pinnedThreads.length === 0;
                            break;
                          case "pinned-divider":
                            items.push(
                              <SidebarDragBoundary
                                key="pinned-divider"
                                marker="pinned-divider"
                                label="Active"
                                visible={from !== null}
                                isDropTarget={dragTargetSection === "active"}
                              />,
                            );
                            // The inbox starts here. Pinned's well stands for
                            // its own shelf, not for the first row of this one,
                            // which has a slot of its own to offer.
                            absorbed = false;
                            break;
                          case "active-placeholder":
                            items.push(
                              <SidebarSectionPlaceholder
                                key="active-placeholder"
                                marker="active-placeholder"
                                label="Active"
                                showHint={
                                  from !== null &&
                                  (activeThreads.length === 0 ||
                                    (from === "active" &&
                                      activeThreads.length === 1 &&
                                      dragTargetSection !== null &&
                                      dragTargetSection !== "active"))
                                }
                                isDropTarget={dragTargetSection === "active"}
                              />,
                            );
                            break;
                          case "working-header":
                            items.push(
                              <SidebarSectionHeader
                                key="working-shelf-header"
                                marker="working-header"
                                className="mt-auto"
                                label={
                                  workingShelfExpanded
                                    ? "Working"
                                    : `Working (${workingThreads.length})`
                                }
                                toggle={{
                                  expanded: workingShelfExpanded,
                                  onToggle: toggleWorkingShelf,
                                }}
                              />,
                            );
                            break;
                          case "snoozed-header":
                            items.push(
                              <SidebarSectionHeader
                                key="snoozed-shelf-header"
                                marker="snoozed-header"
                                className={cn(workingThreads.length === 0 && "mt-auto")}
                                label={
                                  snoozedShelfExpanded
                                    ? "Snoozed"
                                    : `Snoozed (${snoozedThreads.length})`
                                }
                                toggle={{
                                  expanded: snoozedShelfExpanded,
                                  onToggle: toggleSnoozedShelf,
                                }}
                              />,
                            );
                            break;
                          case "settled-header":
                            items.push(
                              <SidebarSectionHeader
                                key="settled-shelf-header"
                                marker="settled-header"
                                className={cn(
                                  workingThreads.length + snoozedThreads.length === 0 && "mt-auto",
                                )}
                                label={
                                  settledShelfExpanded
                                    ? "Settled"
                                    : `Settled (${settledThreads.length})`
                                }
                                dragging={from !== null}
                                isDropTarget={dragTargetSection === "settled"}
                                toggle={{
                                  expanded: settledShelfExpanded,
                                  onToggle: toggleSettledShelf,
                                }}
                              />,
                              // Settled takes a row the way Pinned does, and
                              // says so in the same words.
                              <SidebarDropZone
                                key="settled-drop"
                                testId="sidebar-settled-drop"
                                label="Settle here"
                                open={from !== null && settledThreads.length > 0}
                                isDropTarget={dragTargetSection === "settled"}
                              />,
                            );
                            absorbed = from !== null && settledThreads.length > 0;
                            break;
                          case "settled-placeholder":
                            items.push(
                              <SidebarSectionPlaceholder
                                key="settled-placeholder"
                                marker="settled-placeholder"
                                label="Settled"
                                showHint={settledHint}
                                isDropTarget={dragTargetSection === "settled"}
                              />,
                            );
                            break;
                        }
                      }
                      return items;
                    })()}
                    {settledShelfExpanded && hiddenSettledCount > 0 ? (
                      <li className="list-none">
                        <button
                          type="button"
                          onClick={showMoreSettled}
                          className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground/55 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                        >
                          <PlusIcon aria-hidden className="size-4 shrink-0" />
                          Show {Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT)} more
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </SortableContext>
              </DndContext>
            </TooltipProvider>
          ) : null}
          {!isSearchingThreads &&
          visibleDraftSessionCount === 0 &&
          pinnedThreads.length +
            activeThreads.length +
            workingThreads.length +
            snoozedThreads.length +
            settledThreads.length ===
            0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  <button
                    type="button"
                    onClick={openAddProjectCommandPalette}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-2xs font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    Add project
                  </button>
                </>
              ) : scopedProjectGroup ? (
                `No threads in ${scopedProjectGroup.displayName} yet`
              ) : (
                "No threads yet"
              )}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
