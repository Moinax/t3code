import {
  groupStateLabel,
  titleWithoutGroupPrefix,
  type ThreadGroupTone,
} from "@t3tools/client-runtime/state/thread-groups";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckIcon, ChevronRightIcon, LayersIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  sidebarGroupItemId,
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
 * A folded group shaped like the threads it stands for: members' projects in a thread's project
 * slot, the work named once (a ticket's threads share a title), the group's name where a branch
 * would be, and the agents on the right.
 */
function SidebarFoldedGroupRow(props: {
  groupKey: string;
  name: string;
  size: number;
  members: readonly SidebarGroupMember[];
  onToggle: (groupKey: string) => void;
  onSettleThreads?: (threadKeys: readonly string[]) => void;
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
    id: sidebarGroupItemId(props.groupKey),
    animateLayoutChanges: animateSidebarLayoutChanges,
    disabled:
      props.draggable === true ? SIDEBAR_SORTABLE_DRAG_ENABLED : SIDEBAR_SORTABLE_DRAG_DISABLED,
  });
  return (
    <li
      ref={setNodeRef}
      {...(props.draggable === true ? listeners : {})}
      data-thread-selection-safe
      data-drag-id={sidebarGroupItemId(props.groupKey)}
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
