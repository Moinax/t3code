import { closestCenter, type CollisionDetection, type Modifier } from "@dnd-kit/core";
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import {
  planSidebarGroupMove,
  resolveSidebarDropTarget,
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const stationary = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
const hidden = { ...stationary, scaleY: 0 };
type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;
type Layout = Parameters<SortingStrategy>[0];
const isShelfHeader = (item: SidebarListItem | undefined) =>
  item?.kind === "marker" &&
  (item.marker === "working-header" ||
    item.marker === "snoozed-header" ||
    item.marker === "settled-header");

export function restrictBelowSidebarLabel(
  { transform, containerNodeRect, draggingNodeRect }: Parameters<Modifier>[0],
  offset: number,
) {
  if (!containerNodeRect || !draggingNodeRect) return transform;
  const minimumY = containerNodeRect.top + offset - draggingNodeRect.top;
  return transform.y < minimumY ? { ...transform, y: minimumY } : transform;
}

/**
 * How far below the Pinned boundary a drop still means "pin this": the height
 * of its own label, no more. Past it the markers stop competing with the rows.
 */
const BOUNDARY_REACH = 16;

export function createSidebarCollisionDetection(
  isValidTarget: (id: string) => boolean,
  options: {
    items?: readonly SidebarListItem[];
    activationY?: number | null;
  } = {},
): CollisionDetection {
  const validity = new Map<string, boolean>();
  const sections = new Map<string, SidebarSection | null>();
  let previousPointerY = options.activationY;
  let boundarySection: "pinned" | "active" | undefined;
  return (args) => {
    let collisions = closestCenter(args);
    const pointer = args.pointerCoordinates;
    const items = options.items;
    const source = items?.find((item) => item.kind === "thread" && item.key === args.active.id);
    const boundary = args.droppableContainers
      .find((container) => container.id === sidebarMarkerId("pinned-divider"))
      ?.node.current?.querySelector(".sidebar-drag-boundary-label")
      ?.getBoundingClientRect();
    // A zero-height marker sitting at the top of the list wins on centre
    // distance against any card, whose centre is half a card away: everything
    // dragged near the first row came back pinned. The boundary is a target
    // only while the pointer is in its own band.
    const reachBottom =
      boundary?.bottom ??
      (() => {
        const rect = args.droppableRects.get(sidebarMarkerId("pinned-divider"));
        return rect === undefined ? undefined : rect.top + BOUNDARY_REACH;
      })();
    if (pointer && reachBottom !== undefined && pointer.y > reachBottom) {
      const pinnedMarkers = new Set([
        sidebarMarkerId("pinned-header"),
        sidebarMarkerId("pinned-divider"),
      ]);
      const withoutPinned = collisions.filter(
        (collision) => !pinnedMarkers.has(String(collision.id)),
      );
      if (withoutPinned.length > 0) collisions = withoutPinned;
    }
    if (items && boundary && source?.kind === "thread" && pointer) {
      boundarySection ??= source.section === "pinned" ? "pinned" : "active";
      // Only pointer movement changes sections; opening the destination moves rows under stationary gestures.
      const previousY = previousPointerY ?? pointer.y;
      previousPointerY = pointer.y;
      if (pointer.x >= boundary.left && pointer.x <= boundary.right) {
        // Pinning asks for the label's own band, not for everything above its
        // bottom edge: with no pinned rows the label sits directly on the first
        // inbox row, and "above its bottom" swallowed the whole top of the list
        // — every drag that went near the first card came back pinned.
        if (pointer.y < previousY && pointer.y <= boundary.bottom && pointer.y >= boundary.top)
          boundarySection = "pinned";
        else if (pointer.y > previousY && pointer.y >= boundary.top) boundarySection = "active";
        else if (pointer.y > boundary.bottom) boundarySection = "active";
        const nextHeader = (["working-header", "snoozed-header", "settled-header"] as const)
          .map((marker) =>
            args.droppableContainers.find((container) => container.id === sidebarMarkerId(marker)),
          )
          .find((container) => container !== undefined);
        const activeBottom = nextHeader?.node.current?.getBoundingClientRect().top;
        if (boundarySection === "pinned" || (activeBottom != null && pointer.y < activeBottom)) {
          const target = collisions.find((collision) => {
            const id = String(collision.id);
            if (!sections.has(id)) {
              sections.set(
                id,
                resolveSidebarDropTarget(items, String(args.active.id), id)?.section ?? null,
              );
            }
            return sections.get(id) === boundarySection;
          });
          if (target)
            collisions = [target, ...collisions.filter((collision) => collision !== target)];
        }
      }
    }
    const nearest = collisions[0];
    if (!nearest || nearest.id === args.active.id) {
      return collisions;
    }
    const id = String(nearest.id);
    const valid = validity.get(id) ?? isValidTarget(id);
    validity.set(id, valid);
    return valid ? collisions : collisions.filter((collision) => collision.id === args.active.id);
  };
}

export function createSidebarSortingStrategy(input: {
  items: readonly SidebarListItem[];
  enabled?: boolean;
  /** The hovered row's edge the drop belongs to, so the gap opens where the line is. */
  insertSide?: "above" | "below" | undefined;
  settledOrder: readonly string[];
  activeOrder?: readonly string[];
  settledExpanded: boolean;
  settledVisibleCount?: number;
  routeThreadKey?: string | null;
  snoozedThreadCount?: number;
  cardHeight?: number;
  slimHeight?: number;
  boundaryLabelHeight?: number;
}): SortingStrategy {
  if (input.enabled === false) return () => stationary;
  const { items } = input;
  const indices = new Map(items.map((item, index) => [sidebarListItemId(item), index]));
  let previous: Pick<Layout, "rects" | "activeIndex" | "overIndex"> | undefined;
  let transforms: ReturnType<SortingStrategy>[] | null = [];

  function project({ rects, activeIndex, overIndex }: Layout) {
    const active = items[activeIndex];
    const over = items[overIndex] ?? active;
    if (!active || active.kind === "marker" || !over || !rects[0]) return [];
    // A group travels as the block of its row and its members, so its
    // arrangement is the whole list rather than one row moved inside it.
    const groupPlan =
      active.kind === "group"
        ? planSidebarGroupMove(items, active.groupKey, sidebarListItemId(over), input.insertSide)
        : null;
    if (active.kind === "group") {
      const buffer = ((globalThis as unknown as { __dnd?: unknown[] }).__dnd ??= []);
      buffer.push(["project", sidebarListItemId(over), groupPlan !== null]);
      if (buffer.length <= 30)
        void fetch(
          `/api/__dnd/${encodeURIComponent(JSON.stringify(["project", sidebarListItemId(over), groupPlan !== null]))}`,
        ).catch(() => {});
    }
    const target =
      active.kind === "group"
        ? (groupPlan?.target ?? null)
        : resolveSidebarDropTarget(items, active.key, sidebarListItemId(over), input.insertSide);
    if (!target) return [];
    const groups: Record<SidebarSection, ThreadItem[]> = {
      pinned: [],
      active: [],
      working: [],
      snoozed: [],
      settled: [],
    };
    let cardHeight = input.cardHeight;
    let slimHeight = input.slimHeight;
    let headerScale: number | undefined;
    for (const [index, item] of items.entries()) {
      if (item.kind === "marker") {
        if (isShelfHeader(item)) {
          const height = rects[index]?.height;
          if (height) headerScale ??= height / 32;
        }
        continue;
      }
      if (item.section === "pinned" || item.section === "active" || item.section === "working")
        cardHeight ??= rects[index]?.height;
      else slimHeight ??= rects[index]?.height;
      if (active.kind !== "thread" || item.key !== active.key) groups[item.section].push(item);
    }
    const scale =
      slimHeight !== undefined ? slimHeight / 36 : (headerScale ?? (cardHeight ?? 82) / 82);
    cardHeight ??= 82 * scale;
    slimHeight ??= 36 * scale;
    const labelHeight = (input.boundaryLabelHeight ?? 0) * scale;
    const projected: SidebarListItem[] = [];
    if (groupPlan !== null) {
      projected.push(...groupPlan.items);
    } else if (active.kind === "thread") {
      const group = groups[target.section];
      const order =
        target.section === "pinned"
          ? target.pinnedOrder
          : target.section === "settled"
            ? input.settledOrder
            : (input.activeOrder ?? target.activeOrder);
      const ranks = new Map(order.map((key, index) => [key, index]));
      const rank = ranks.get(active.key) ?? Number.POSITIVE_INFINITY;
      const index = group.findIndex(
        (item) => (ranks.get(item.key) ?? Number.POSITIVE_INFINITY) > rank,
      );
      group.splice(index < 0 ? group.length : index, 0, { ...active, section: target.section });
      const settledOrder = (
        input.settledOrder.length > 0 ? input.settledOrder : groups.settled.map((item) => item.key)
      ).filter((key) => key !== active.key || target.section === "settled");
      const visible = input.settledExpanded
        ? settledOrder.slice(0, input.settledVisibleCount ?? settledOrder.length)
        : [];
      const routeKey = input.routeThreadKey;
      if (routeKey && settledOrder.includes(routeKey) && !visible.includes(routeKey)) {
        visible.push(routeKey);
      }
      groups.settled = visible.map((key) => ({ kind: "thread", key, section: "settled" }));
      const marker = (name: SidebarListMarker) => projected.push({ kind: "marker", marker: name });
      // A group's row belongs to the arrangement even when nothing of its own
      // moved: left out, it would be the one row that never shifts while the
      // list opens around it, and no gap could ever appear at its slot. It is
      // emitted above the row it sits above — its first member when it is
      // unfolded, and whatever follows it when a fold has hidden them.
      // Several folded groups can follow the same row, so each anchor keeps a
      // list: dropping them in a map by key made all but the last disappear
      // from the arrangement, and a row missing from it takes its height with
      // it — which is what made every card drift and gather mid-list.
      const above = new Map<string, SidebarListItem[]>();
      const below = new Map<string, SidebarListItem[]>();
      const leading: Array<Extract<SidebarListItem, { kind: "group" }>> = [];
      const push = (map: Map<string, SidebarListItem[]>, key: string, item: SidebarListItem) =>
        map.set(key, [...(map.get(key) ?? []), item]);
      for (const [index, item] of items.entries()) {
        if (item.kind !== "group") continue;
        const firstMember = item.memberKeys.find((key) => indices.has(key));
        if (firstMember !== undefined) {
          push(above, firstMember, item);
          continue;
        }
        // Folded: no member of its own to sit above, so it keeps its place
        // behind the row it followed rather than chasing the one it preceded.
        // In its own section only — anchored to a pinned row, a folded group
        // was emitted among the pins and the inbox read as empty.
        const previous = items
          .slice(0, index)
          .findLast(
            (candidate): candidate is ThreadItem =>
              candidate.kind === "thread" && candidate.section === item.section,
          )?.key;
        if (previous === undefined) leading.push(item);
        else push(below, previous, item);
      }
      const withGroupRows = (
        list: readonly ThreadItem[],
        name: SidebarSection,
      ): SidebarListItem[] => [
        ...leading.filter((item) => item.section === name),
        ...list.flatMap((item) => [
          ...(above.get(item.key) ?? []),
          item,
          ...(below.get(item.key) ?? []),
        ]),
      ];
      // The inbox is laid out from the order the drop would write, not from
      // the rows that happen to be on screen: a folded group has no member row
      // to carry its place, so walking the visible rows left it wherever a
      // heuristic put it and no gap ever opened where the drop was aimed.
      const groupByMember = new Map<string, Extract<SidebarListItem, { kind: "group" }>>();
      for (const item of items) {
        if (item.kind !== "group") continue;
        for (const key of item.memberKeys) groupByMember.set(key, item);
      }
      const activeRows = () => {
        const byKey = new Map(groups.active.map((item) => [item.key, item] as const));
        if (active.kind === "thread") byKey.set(active.key, { ...active, section: "active" });
        const rows: SidebarListItem[] = [];
        const seenGroups = new Set<string>();
        for (const key of order) {
          const groupItem = groupByMember.get(key);
          if (groupItem !== undefined && !seenGroups.has(groupItem.groupKey)) {
            seenGroups.add(groupItem.groupKey);
            rows.push(groupItem);
          }
          const row = byKey.get(key);
          if (row !== undefined) rows.push(row);
        }
        return rows;
      };
      const section = (name: "active" | "settled") => {
        // A section holding nothing but folded groups is not an empty section:
        // counting its threads alone put the "nothing here" placeholder under
        // two group cards, and a drop aimed at it landed past the whole list.
        const rows =
          name === "active" && target.section === "active"
            ? activeRows()
            : withGroupRows(groups[name], name);
        if (rows.length > 0) projected.push(...rows);
        else marker(`${name}-placeholder`);
      };
      marker("pinned-header");
      projected.push(...withGroupRows(groups.pinned, "pinned"));
      marker("pinned-divider");
      section("active");
      if (items.some((item) => item.kind === "marker" && item.marker === "working-header")) {
        marker("working-header");
        projected.push(...withGroupRows(groups.working, "working"));
      }
      if (
        groups.snoozed.length > 0 ||
        ((active.section !== "snoozed" || (input.snoozedThreadCount ?? 0) > 1) &&
          items.some((item) => item.kind === "marker" && item.marker === "snoozed-header"))
      ) {
        marker("snoozed-header");
        projected.push(...groups.snoozed);
      }
      marker("settled-header");
      section("settled");
    }
    const heights = projected.map((item) => {
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      const fallback =
        item.kind === "thread" &&
        (item.section === "pinned" || item.section === "active" || item.section === "working")
          ? cardHeight
          : slimHeight;
      const moved = active.kind === "thread" && item.kind === "thread" && item.key === active.key;
      return item.kind === "marker" &&
        (item.marker === "pinned-header" || item.marker === "pinned-divider")
        ? labelHeight
        : item.kind === "marker" && item.marker.endsWith("placeholder")
          ? slimHeight
          : moved
            ? fallback
            : (rect?.height ?? fallback);
    });
    const firstShelf = items.findIndex(isShelfHeader);
    const shelfRect = rects[firstShelf];
    const beforeShelf = rects[firstShelf - 1];
    const lastRect = rects.at(-1);
    let shelfSpace =
      shelfRect && beforeShelf && lastRect && shelfRect.top > beforeShelf.bottom + 1
        ? Math.max(
            0,
            lastRect.bottom - rects[0].top - heights.reduce((sum, height) => sum + height + 1, -1),
          )
        : 0;
    const result = items.map(() => hidden);
    let top = rects[0].top;
    for (const [projectedIndex, item] of projected.entries()) {
      if (isShelfHeader(item)) {
        top += shelfSpace;
        shelfSpace = 0;
      }
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      if (index !== undefined && rect) result[index] = { ...stationary, y: top - rect.top };
      top += heights[projectedIndex]! + 1;
    }
    result[activeIndex] = stationary;
    return result;
  }

  return (args) => {
    if (
      previous?.rects !== args.rects ||
      previous.activeIndex !== args.activeIndex ||
      previous.overIndex !== args.overIndex
    ) {
      previous = args;
      transforms = project(args);
    }
    return transforms === null
      ? verticalListSortingStrategy(args)
      : (transforms[args.index] ?? stationary);
  };
}
