import {
  groupStateLabel,
  titleWithoutGroupPrefix,
  type ThreadGroupTone,
} from "@t3tools/client-runtime/state/thread-groups";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckIcon, ChevronRightIcon, LayersIcon, PinIcon, Undo2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import {
  SIDEBAR_SORTABLE_DRAG_DISABLED,
  SIDEBAR_SORTABLE_DRAG_ENABLED,
  SidebarDropWell,
  SidebarJoinBadge,
  SidebarProviderStack,
  sidebarStateVisual,
  SnoozeMenuButton,
  type SidebarProviderEntry,
} from "./SidebarThreadRow";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SnoozePreset } from "../Sidebar.snooze";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { SidebarThreadSummary } from "../../types";

function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
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
        props.open ? "h-10" : "h-0",
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
};

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
 * A folded group, shaped like the threads it stands for: the same three lines
 * in the same order. Its members' projects take the slot a thread gives its
 * own, the work itself is named once — the threads of a ticket carry the same
 * title and differ only by repository, so the first one speaks for all — and
 * the group's name sits where a thread shows its branch, with the agents on
 * the right as on any other card.
 */
function SidebarFoldedGroupRow(props: {
  groupKey: string;
  name: string;
  size: number;
  members: readonly SidebarGroupMember[];
  onToggle: (groupKey: string) => void;
  onSettleThreads?: (threadKeys: readonly string[]) => void;
  onUnsettleThreads?: (threadKeys: readonly string[]) => void;
  onSnoozeThreads?: (
    threadKeys: readonly string[],
    preset: Pick<SnoozePreset, "snoozedUntil">,
  ) => void;
  timestampFormat?: TimestampFormat;
}) {
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
  // All of them or none: a half-unsettled group would leave rows on two
  // shelves, which is the thing this row exists to prevent.
  // A pinned group says so where a pinned thread does, and an unpin from here
  // would take the whole group, so the row shows the state and leaves the
  // undoing to the gesture that put it there.
  const pinned = props.members.length > 0 && props.members.every((member) => member.isPinned);
  const unsettleKeys =
    props.members.length > 0 && props.members.every((member) => member.isSettled)
      ? props.members.map((member) => member.key)
      : [];
  const canSnoozeGroup =
    props.members.length > 0 && props.members.every((member) => member.canSnooze);
  return (
    // A div, not a button: the quick actions are buttons of their own, and a
    // button cannot hold another.
    <div
      role="button"
      tabIndex={0}
      data-testid="sidebar-group-folded"
      aria-label={`Unfold ${props.name}, ${props.size} threads`}
      onClick={() => props.onToggle(props.groupKey)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onToggle(props.groupKey);
      }}
      className="group/folded-group relative block h-[4.875rem] w-full cursor-pointer overflow-hidden rounded-md px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="flex h-5 min-w-0 items-center gap-1.5 text-xs">
        {pinned ? (
          <PinIcon aria-label="Pinned" className="size-3 shrink-0 text-muted-foreground/65" />
        ) : null}
        <span className="flex shrink-0 items-center gap-0.5">
          {props.members.map((member) =>
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
                label={`Snooze ${props.size} threads`}
              />
            ) : null}
            <ChevronRightIcon
              aria-hidden
              className="ml-0.5 size-4 shrink-0 text-muted-foreground"
            />
          </span>
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
    </div>
  );
}

/**
 * A group's own row. Open, it only names the group — the member rows below say
 * everything else. Folded, it is all that is left of them, so it carries their
 * projects and how they are doing.
 */
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
  onSettleThreads?: (threadKeys: readonly string[]) => void;
  onUnsettleThreads?: (threadKeys: readonly string[]) => void;
  onSnoozeThreads?: (
    threadKeys: readonly string[],
    preset: Pick<SnoozePreset, "snoozedUntil">,
  ) => void;
  timestampFormat?: TimestampFormat;
  draggable?: boolean;
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
          onBlur={(event) => props.onCommitRename?.(props.groupKey, event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter")
              props.onCommitRename?.(props.groupKey, event.currentTarget.value);
            if (event.key === "Escape") props.onCancelRename?.();
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
  const snoozed = shelf === "snoozed";
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("mx-0.5 h-8", props.className)}
    >
      <CollapsibleSectionHeader
        onClick={props.toggle.onToggle}
        expanded={props.toggle.expanded}
        tone={
          props.isDropTarget ? "accent" : props.dragging ? "emphasized" : snoozed ? "info" : "muted"
        }
        data-testid={`sidebar-${shelf}-shelf-toggle`}
      >
        {props.label}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}
