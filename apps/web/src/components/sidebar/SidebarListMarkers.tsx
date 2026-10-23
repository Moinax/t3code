import {
  groupStateLabel,
  titleWithoutGroupPrefix,
  type ThreadGroupTone,
} from "@t3tools/client-runtime/state/thread-groups";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlarmClockOffIcon,
  CheckIcon,
  ChevronRightIcon,
  LayersIcon,
  PinIcon,
  Undo2Icon,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import {
  RelativeTimeLabel,
  SIDEBAR_SORTABLE_DRAG_DISABLED,
  SIDEBAR_SORTABLE_DRAG_ENABLED,
  SidebarDropWell,
  SidebarJoinBadge,
  SidebarProviderStack,
  sidebarStateVisual,
  SnoozeMenuButton,
  type SidebarProviderEntry,
} from "./SidebarThreadRow";
import { groupTimestamp } from "./threadTime.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SnoozePreset } from "../Sidebar.snooze";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { SidebarThreadSummary } from "../../types";

function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  revealOverflow?: boolean;
  "data-testid"?: string;
}) {
  const { node, setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the projected drop box inside the scroll viewport as drag transforms move it
  useLayoutEffect(() => {
    if (props.revealOverflow && transform?.y !== undefined) {
      node.current?.firstElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [node, props.revealOverflow, transform?.y]);
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-drag-id={sidebarMarkerId(props.marker)}
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

export function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
      revealOverflow={props.marker === "settled-placeholder" && props.showHint}
    >
      {props.showHint ? (
        <SidebarDropWell
          label={props.label}
          active={props.isDropTarget}
          className="absolute inset-x-0 top-0 h-9"
        />
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn(
        "pointer-events-none relative mx-0.5 overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none",
        // Its own band while a drag is live: hanging out of a marker of no
        // height, the label drew over the first row of the shelf it names.
        props.visible ? "h-5" : "h-0",
      )}
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label flex h-4 items-center gap-2 px-1.5">
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              props.isDropTarget ? "text-primary" : "text-sidebar-foreground/80",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-foreground/25",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

/**
 * A place a release would put the row, in the one language this sidebar already
 * has for it: the dashed well the Settled shelf shows. It lives in the list
 * rather than over it, so the rows below it make room by moving down, and the
 * only motion a drag produces is that gap opening and closing.
 */
export function SidebarDropZone(props: {
  label: string;
  open: boolean;
  isDropTarget?: boolean;
  testId?: string;
}) {
  return (
    <li
      aria-hidden
      data-testid={props.testId ?? "sidebar-drop-zone"}
      // The rows part to make room rather than jumping apart. Only the height
      // of this one element animates, and only when the well opens or closes.
      className={cn(
        "mx-0.5 list-none overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none",
        // Closed, it gives back the list's own row gap too: a drag lays one of
        // these between every pair of rows, and a pixel each is a list that
        // lurches the moment a hand moves.
        props.open ? "h-10" : "h-0 -mt-px",
      )}
    >
      <SidebarDropWell
        label={props.label}
        active={props.isDropTarget !== false}
        className={cn(
          "h-full transition-opacity duration-150 ease-out",
          props.open ? "opacity-100" : "opacity-0",
        )}
      />
    </li>
  );
}

/** How a hidden member shows up on a folded group's row. */
export type SidebarGroupMember = {
  readonly key: string;
  readonly project: ProjectFaviconProject | null;
  readonly tone: ThreadGroupTone;
  readonly title: string;
  readonly thread: SidebarThreadSummary;
  /** Resolved per member: a group can hold threads from several environments. */
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  readonly canSettle: boolean;
  /** Put away already: the group's row offers the way back, for all of them. */
  readonly isSettled: boolean;
  readonly isPinned: boolean;
  readonly canSnooze: boolean;
  readonly isSnoozed: boolean;
};

/**
 * One member per project, in the order they appear.
 *
 * The icons answer "where is this", not "how many threads are there" — the
 * count beside the name already says that. Three threads of one project are
 * one icon, where repeating it only ate the title's width.
 */
function membersByProject(members: readonly SidebarGroupMember[]): readonly SidebarGroupMember[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    if (member.project === null) return false;
    const key = `${member.project.environmentId}\u0000${member.project.workspaceRoot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One member per agent, in the order they appear.
 *
 * The icons answer "who is on this", not "how many threads are there" — the
 * line above already counts those. Six threads on the same provider are one
 * icon, and the same six split between two are two.
 */
function membersByAgent(members: readonly SidebarGroupMember[]): readonly SidebarGroupMember[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    const stack = resolveThreadProviderStack(member.thread);
    const agent = stack[stack.length - 1];
    if (agent === undefined || seen.has(agent)) return false;
    seen.add(agent);
    return true;
  });
}

/**
 * A folded group drawn as whatever its shelf is made of: a card where its members would
 * have been cards, one line on the settled shelf where they would have been lines. Either
 * way it stands for them, with their projects and what they are doing.
 */
function SidebarFoldedGroupRow(props: {
  groupKey: string;
  name: string;
  size: number;
  isActive?: boolean;
  members: readonly SidebarGroupMember[];
  onToggle: (groupKey: string) => void;
  onSettleThreads?: (threadKeys: readonly string[]) => void;
  onUnsettleThreads?: (threadKeys: readonly string[]) => void;
  onUnsnoozeThreads?: (threadKeys: readonly string[]) => void;
  onSnoozeThreads?: (
    threadKeys: readonly string[],
    preset: Pick<SnoozePreset, "snoozedUntil">,
  ) => void;
  timestampFormat?: TimestampFormat;
  /** The row its shelf is made of, as a thread's own row takes it. */
  variant: "card" | "slim";
}) {
  const slim = props.variant === "slim";
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const state = groupStateLabel(props.members.map((member) => member.tone));
  // A folded group reports in the vocabulary of the rows it stands in for, and
  // a group wanting attention is a thread asking for input.
  const stateVisual = sidebarStateVisual[state.tone === "attention" ? "input" : state.tone];
  const title = titleWithoutGroupPrefix(props.members[0]?.title ?? props.name);
  const memberKeys = props.members.map((member) => member.key);
  // Settle takes whoever is left to settle; snooze is all or nothing, as it is
  // for a multiple selection — a half-snoozed group would hide no row.
  const settleKeys = props.members.filter((member) => member.canSettle).map((member) => member.key);
  // A pinned group shows it like a pinned thread, but unpinning here would take the
  // whole group, so undoing is left to the gesture that pinned it.
  const pinned = props.members.length > 0 && props.members.every((member) => member.isPinned);
  // All of them or none: a half-unsettled group would leave rows on two
  // shelves, which is the thing this row exists to prevent.
  const unsettleKeys =
    props.members.length > 0 && props.members.every((member) => member.isSettled) ? memberKeys : [];
  const canSnoozeGroup =
    props.members.length > 0 && props.members.every((member) => member.canSnooze);
  // Snoozed, the group's row is the only handle left on its threads: waking
  // takes all of them back, as un-settling does.
  const unsnoozeKeys = props.members
    .filter((member) => member.isSnoozed)
    .map((member) => member.key);
  const quickActions = (
    <span
      className={cn(
        "absolute right-0 flex items-center opacity-0 transition-opacity group-hover/folded-group:opacity-100",
        snoozeMenuOpen && "opacity-100",
      )}
    >
      {unsettleKeys.length > 0 && props.onUnsettleThreads ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Un-settle ${unsettleKeys.length} threads`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onUnsettleThreads?.(unsettleKeys);
                }}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Undo2Icon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">{`Un-settle ${unsettleKeys.length} threads`}</TooltipPopup>
        </Tooltip>
      ) : null}
      {unsnoozeKeys.length > 0 && props.onUnsnoozeThreads ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Wake ${unsnoozeKeys.length} threads`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onUnsnoozeThreads?.(unsnoozeKeys);
                }}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <AlarmClockOffIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">{`Wake ${unsnoozeKeys.length} threads`}</TooltipPopup>
        </Tooltip>
      ) : null}
      {settleKeys.length > 0 && props.onSettleThreads ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Settle ${settleKeys.length} threads`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onSettleThreads?.(settleKeys);
                }}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <CheckIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">{`Settle ${settleKeys.length} threads`}</TooltipPopup>
        </Tooltip>
      ) : null}
      {canSnoozeGroup && props.onSnoozeThreads && props.timestampFormat ? (
        <SnoozeMenuButton
          open={snoozeMenuOpen}
          onOpenChange={setSnoozeMenuOpen}
          onSnooze={(preset) => props.onSnoozeThreads?.(memberKeys, preset)}
          timestampFormat={props.timestampFormat}
          environmentId={props.members[0]!.thread.environmentId}
          label={`Snooze ${props.size} threads`}
        />
      ) : null}
      <ChevronRightIcon aria-hidden className="ml-0.5 size-4 shrink-0 text-muted-foreground" />
    </span>
  );
  return (
    // A div, not a button: the quick actions are buttons of their own, and a
    // button cannot hold another.
    <div
      role="button"
      tabIndex={0}
      data-testid="sidebar-group-folded"
      aria-label={`Unfold ${props.name}, ${props.size} threads`}
      // The row the open thread would have had is folded away, so this one
      // answers for it: lit like that row, and the one the reveal scrolls to.
      aria-current={props.isActive === true ? "page" : undefined}
      onClick={() => props.onToggle(props.groupKey)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onToggle(props.groupKey);
      }}
      className={cn(
        "group/folded-group relative w-full cursor-pointer overflow-hidden rounded-md px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // The shape its own shelf gives its members: a one-line group among
        // cards is as foreign as a card was among lines.
        slim ? "flex h-8 items-center gap-1.5" : "block h-[4.875rem] py-(--sidebar-content-inset)",
        props.isActive === true && "bg-sidebar-row-active text-sidebar-foreground",
      )}
    >
      {slim ? (
        <>
          {pinned ? (
            <PinIcon aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground/65" />
          ) : null}
          <span className="flex shrink-0 items-center gap-0.5 opacity-40 grayscale transition-opacity group-focus-within/folded-group:opacity-100 group-focus-within/folded-group:grayscale-0 group-hover/folded-group:opacity-100 group-hover/folded-group:grayscale-0">
            {membersByProject(props.members).map((member) =>
              member.project ? (
                <ProjectFavicon key={member.key} project={member.project} className="size-4" />
              ) : null,
            )}
          </span>
          {/* Read in the words of the rows it hides, so it recedes with them
              instead of being the one bright title on a quiet shelf. */}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              "group-focus-within/folded-group:text-foreground group-hover/folded-group:text-foreground",
              state.tone === "done"
                ? "font-normal text-secondary-label"
                : "font-medium text-foreground",
            )}
          >
            {title}
          </span>
          {state.tone === "done" ? null : (
            <span className={cn("inline-flex shrink-0 items-center", stateVisual.className)}>
              <stateVisual.Icon aria-hidden className="size-3" />
              <span role="status" className="sr-only">
                {state.label}
              </span>
            </span>
          )}
          {/* The group's own name and size, where a thread's row carries its meta.
              Out of the way while the pointer is here: the quick actions land on
              this half of the row. */}
          <span className="flex min-w-0 shrink items-center gap-1 text-xs text-muted-foreground/40 transition-opacity group-hover/folded-group:opacity-0">
            <span className="truncate">{props.name}</span>
            <span className="shrink-0 tabular-nums">{props.size}</span>
          </span>
          {/* The time and the fold share one slot, as a thread's row shares its own
              between its time and its controls. */}
          <span className="relative flex h-5 shrink-0 items-center text-xs">
            <span className="inline-flex justify-end tabular-nums text-secondary-label transition-opacity group-hover/folded-group:opacity-0">
              <RelativeTimeLabel timestamp={groupTimestamp(props.members)} />
            </span>
            {quickActions}
          </span>
        </>
      ) : (
        <>
          <span className="flex h-5 min-w-0 items-center gap-1.5 text-xs">
            {pinned ? (
              <PinIcon aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground/65" />
            ) : null}
            <span className="flex shrink-0 items-center gap-0.5">
              {membersByProject(props.members).map((member) =>
                member.project ? (
                  <ProjectFavicon key={member.key} project={member.project} className="size-4" />
                ) : null,
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-secondary-label font-medium tabular-nums">
              {props.size} threads
            </span>
            {/* The state and the fold share one slot, as a thread's row shares its
                own between its state and its controls: what the group is doing is
                worth more than an arrow, until the pointer says otherwise. */}
            <span className="relative flex h-5 shrink-0 items-center">
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-medium transition-opacity group-hover/folded-group:opacity-0",
                  stateVisual.className,
                )}
              >
                <stateVisual.Icon aria-hidden className="size-4 shrink-0" />
                <span role="status">{state.label}</span>
              </span>
              {quickActions}
            </span>
          </span>
          <span className="mt-1 block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            <LayersIcon aria-hidden className="size-3 shrink-0 text-muted-foreground/40" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground/40">{props.name}</span>
            <span aria-hidden className="ml-auto inline-flex shrink-0 items-center gap-1">
              {membersByAgent(props.members).map((member) => (
                <SidebarProviderStack
                  key={member.key}
                  thread={member.thread}
                  providerEntryByInstanceId={member.providerEntryByInstanceId}
                />
              ))}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * A group's own row. Open, it only names the group — the member rows below say
 * everything else. Folded, it is all that is left of them, so it carries their
 * projects and how they are doing.
 */
/**
 * Leave nothing focused once a rename settles. The sidebar tree hands a vanished
 * input's focus to its selected row unless focus has left the tree, so it goes
 * through a throwaway element outside it, and the blur that causes is no commit.
 */
function releaseTreeFocus(input: HTMLInputElement) {
  input.dataset.settled = "";
  const sink = document.createElement("span");
  sink.tabIndex = -1;
  document.body.append(sink);
  sink.focus({ preventScroll: true });
  sink.remove();
}

export function SidebarGroupHeader(props: {
  groupKey: string;
  /** This row's own id: the same group may have one on another shelf. */
  itemId: string;
  name: string;
  size: number;
  expanded: boolean;
  members: readonly SidebarGroupMember[];
  onToggle: (groupKey: string) => void;
  renaming?: boolean;
  onCommitRename?: (groupKey: string, name: string) => void;
  onCancelRename?: () => void;
  onContextMenu?: (groupKey: string, position: { x: number; y: number }) => void;
  isJoinTarget?: boolean;
  /** The open thread is one of the folded members, so this row stands in for it. */
  isActive?: boolean;
  onSettleThreads?: (threadKeys: readonly string[]) => void;
  onUnsettleThreads?: (threadKeys: readonly string[]) => void;
  onUnsnoozeThreads?: (threadKeys: readonly string[]) => void;
  onSnoozeThreads?: (
    threadKeys: readonly string[],
    preset: Pick<SnoozePreset, "snoozedUntil">,
  ) => void;
  timestampFormat?: TimestampFormat;
  draggable?: boolean;
  variant: "card" | "slim";
}) {
  // The group's row is its handle: picking it up moves the whole block, the
  // way picking up a thread moves that thread.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.itemId,
    animateLayoutChanges: animateSidebarLayoutChanges,
    disabled:
      props.draggable === true ? SIDEBAR_SORTABLE_DRAG_ENABLED : SIDEBAR_SORTABLE_DRAG_DISABLED,
  });
  return (
    <li
      ref={setNodeRef}
      {...(props.draggable === true ? listeners : {})}
      data-thread-selection-safe
      data-drag-id={props.itemId}
      data-testid="sidebar-group-header"
      className={cn(
        "mx-0.5 list-none rounded-md",
        // Folded, the row stands in for its threads, so it takes a thread's
        // own height rather than a separator's.
        props.expanded || props.renaming === true ? "h-8" : "py-0.5",
        props.isJoinTarget === true && "ring-2 ring-inset ring-primary",
        // Carried the way a thread's card is, and outlined for the same
        // reason; its slot gives up its height so the only gap on screen is
        // the one it would land in. The surface goes on the card rather than
        // here: a slot of no height paints no background to be read against.
        isDragging &&
          "z-20 h-0 py-0 [&>*]:rounded-md [&>*]:bg-sidebar-row-active [&>*]:shadow-lg [&>*]:ring-1 [&>*]:ring-primary/40",
        "relative",
      )}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onContextMenu={(event) => {
        if (props.onContextMenu === undefined) return;
        event.preventDefault();
        props.onContextMenu(props.groupKey, { x: event.clientX, y: event.clientY });
      }}
    >
      {props.isJoinTarget === true ? <SidebarJoinBadge label="Add to group" /> : null}
      {props.renaming === true ? (
        <input
          autoFocus
          defaultValue={props.name}
          aria-label="Group name"
          data-testid="sidebar-group-rename"
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            if (event.currentTarget.dataset.settled === undefined)
              props.onCommitRename?.(props.groupKey, event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            // preventDefault: the Enter's keypress would otherwise click
            // whatever holds focus once the input is gone.
            if (event.key === "Enter") {
              event.preventDefault();
              props.onCommitRename?.(props.groupKey, event.currentTarget.value);
              releaseTreeFocus(event.currentTarget);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              props.onCancelRename?.();
              releaseTreeFocus(event.currentTarget);
            }
            event.stopPropagation();
          }}
          className="h-8 w-full rounded-md bg-transparent px-2 text-xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        />
      ) : props.expanded ? (
        <CollapsibleSectionHeader
          onClick={() => props.onToggle(props.groupKey)}
          expanded
          tone="accent"
          aria-label={`Fold ${props.name}, ${props.size} threads`}
          accessory={
            <span className="shrink-0 tabular-nums text-sidebar-muted-foreground/60">
              {props.size}
            </span>
          }
        >
          {props.name}
        </CollapsibleSectionHeader>
      ) : (
        <SidebarFoldedGroupRow {...props} />
      )}
    </li>
  );
}

export function SidebarSectionHeader(props: {
  marker: "working-header" | "snoozed-header" | "settled-header";
  label: string;
  /** A muted trailing count. */
  count: number;
  className?: string;
  dragging?: boolean;
  isDropTarget?: boolean;
  toggle: { expanded: boolean; onToggle: () => void };
}) {
  const shelf =
    props.marker === "working-header"
      ? "working"
      : props.marker === "snoozed-header"
        ? "snoozed"
        : "settled";
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("relative mx-0.5 h-8", props.className)}
    >
      <CollapsibleSectionHeader
        role="treeitem"
        tabIndex={-1}
        data-sidebar-row={`shelf:${shelf}`}
        onClick={props.toggle.onToggle}
        expanded={props.toggle.expanded}
        tone={props.isDropTarget ? "accent" : props.dragging ? "emphasized" : "muted"}
        data-testid={`sidebar-${shelf}-shelf-toggle`}
        accessory={<span className="font-normal tabular-nums">{props.count}</span>}
      >
        {props.label}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}
