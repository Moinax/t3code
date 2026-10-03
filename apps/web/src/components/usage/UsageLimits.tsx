import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ProviderConsumeResetCreditOutcome,
  ProviderConsumeResetCreditInput,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  providersWithLimits,
  formatDuration,
  formatResetsIn,
  type LimitPresentations,
  limitsNotice,
  type LimitPace,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { GaugeIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Fragment, type ReactNode, useLayoutEffect, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { observeResize } from "../../lib/observeResize";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UsageLimitsPooled } from "./UsageLimitsPooled";
import { PROVIDER_PRESENTATION } from "./usageProviders";

const PACE: Record<LimitPace, { readonly label: string; readonly icon: typeof GaugeIcon }> = {
  ahead: { label: "Ahead of pace: spending faster than the window elapses", icon: TrendingUpIcon },
  on: { label: "On pace with the window", icon: GaugeIcon },
  under: { label: "Under pace: headroom left for the rest of the window", icon: TrendingDownIcon },
};

export function barColor(driver: ServerProvider["driver"]): string {
  const presentation = Object.values(PROVIDER_PRESENTATION).find(
    (entry) => entry.driverKind === driver,
  );
  return presentation?.color ?? "var(--foreground)";
}

export function PaceIcon({ pace }: { readonly pace: LimitPace }) {
  const Icon = PACE[pace].icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={PACE[pace].label}
            className="inline-flex text-muted-foreground"
          />
        }
      >
        <Icon className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="top">{PACE[pace].label}</TooltipPopup>
    </Tooltip>
  );
}

// The tick sits in a transparent gap cut from the bar, clamped so it stays inside at 0% and 100%.
// The gap is a clip-path slot rather than a mask: a mask composites its layer and re-antialiases
// the bar's rounded ends, and the polygon reaches 1px past the box so only the slot edges clip.
function paceMarkStyles(timeLeft: number | null) {
  if (timeLeft === null) return null;
  const at = `clamp(3px, ${timeLeft}%, calc(100% - 3px))`;
  const [left, right] = [`calc(${at} - 3px)`, `calc(${at} + 3px)`];
  const [near, far] = ["-1px", "calc(100% + 1px)"];
  return {
    tick: { left: at },
    gap: {
      clipPath: `polygon(${near} ${near}, ${left} ${near}, ${left} ${far}, ${right} ${far}, ${right} ${near}, ${far} ${near}, ${far} ${far}, ${near} ${far})`,
    },
    // For a track painted on an element that also draws focus rings, which a clip would cut.
    gappedTrack: {
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(to right, var(--color-muted) ${left}, transparent ${left}, transparent ${right}, var(--color-muted) ${right})`,
    },
  };
}

/**
 * Pace mark styles for the bar given the returned ref. Below 6px there is no room for the gap
 * and tick, so the bar draws neither, as the mobile bars do.
 */
export function usePaceMark(timeLeft: number | null) {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [roomy, setRoomy] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the bar DOM width before paint and remeasures through a ResizeObserver
  useLayoutEffect(() => {
    if (!bar) return;
    const measure = () => setRoomy(bar.getBoundingClientRect().width >= 6);
    measure();
    return observeResize(bar, measure);
  }, [bar]);
  return [setBar, roomy ? paceMarkStyles(timeLeft) : null] as const;
}

function WindowBar({
  color,
  window,
  now,
}: {
  readonly color: string;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const [barRef, paceMark] = usePaceMark(timeLeft);
  const resetsIn = formatResetsIn(window, now);
  const resetsAt = window.resetsAt
    ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)
    : null;
  const summary = `${window.label}: ${remaining}% left${
    timeLeft === null ? "" : `, ${timeLeft}% of the window left`
  }${resetsIn ? `, ${resetsIn}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            ref={barRef}
            role="img"
            aria-label={summary}
            tabIndex={0}
            className="relative h-6 cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
        }
      >
        {/* Clip both layers so the gap exposes even a translucent composer surface. */}
        <div className="absolute inset-0" style={paceMark?.gap}>
          <div className="absolute inset-x-0 inset-y-1.5 rounded-full bg-muted" />
          {remaining > 0 ? (
            <div
              className="absolute inset-y-1.5 left-0 rounded-full"
              style={{ width: `${remaining}%`, backgroundColor: color }}
            />
          ) : null}
        </div>
        {paceMark ? (
          <span
            aria-hidden
            className="absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
            style={paceMark.tick}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">
            {remaining}% left{timeLeft !== null ? ` · ${timeLeft}% of the window left` : ""}
          </span>
          {timeLeft !== null ? (
            <span className="text-muted-foreground">The line is where even spending would be.</span>
          ) : null}
          {resetsAt ? (
            <span className="text-muted-foreground">
              Resets {resetsAt}
              {resetsIn ? ` · ${resetsIn}` : ""}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function LimitWindows({
  driver,
  accentColor,
  windows,
  now,
  compact = false,
}: {
  readonly driver: ServerProvider["driver"];
  readonly accentColor?: string | undefined;
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly now: number;
  readonly compact?: boolean;
}) {
  const color = normalizeProviderAccentColor(accentColor) ?? barColor(driver);
  return (
    <div
      className={
        compact
          ? "grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] gap-x-3 gap-y-0.5"
          : "grid grid-cols-[11rem_minmax(0,1fr)_7rem] gap-x-4 gap-y-1"
      }
    >
      {windows.map((window) => {
        const pace = paceOf(window, now);
        const resetsIn = formatResetsIn(window, now);
        return (
          <Fragment key={window.id}>
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{window.label}</span>
              <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
                {remainingPercent(window)}% left
              </span>
            </span>
            <WindowBar color={color} window={window} now={now} />
            <span className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {pace ? <PaceIcon pace={pace} /> : null}
              <span className="ms-auto shrink-0">{resetsIn ?? ""}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

const OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

export function useResetCredit(
  environmentId: EnvironmentId,
  input: ProviderConsumeResetCreditInput,
) {
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, { reportFailure: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const redeem = async () => {
    setConfirming(false);
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setBusy(true);
    setStatus(null);
    const result = await consume({ environmentId, input });
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value.warning ?? OUTCOME_TEXT[result.value.outcome]);
      return;
    }
    setStatus(
      "error" in result.cause && result.cause.error instanceof Error
        ? result.cause.error.message
        : "Could not use the reset credit.",
    );
  };

  return { canManageProviders, confirming, setConfirming, busy, status, redeem };
}

/** Require confirmation because redemption spends credits. Mount outside popovers, which stack above
 * dialogs and unmount on close. */
export function ResetCreditDialog({
  open,
  onOpenChange,
  onConfirm,
  disabled = false,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Use a reset credit?</AlertDialogTitle>
          <AlertDialogDescription>
            This redeems one credit on your account and clears the current rate-limit windows. It
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button disabled={disabled} onClick={onConfirm}>
            Use credit
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function resetCreditsSummary(
  credits: ServerProviderResetCredits,
  now: number,
  compact = false,
): string {
  const expiresIn = credits.nextExpiresAt
    ? formatDuration(Date.parse(credits.nextExpiresAt) - now)
    : null;
  if (credits.availableCount === 0) return "No reset credits banked";
  if (compact)
    return `${credits.availableCount} banked${expiresIn ? ` · expires in ${expiresIn}` : ""}`;
  return `${credits.availableCount} ${credits.availableCount === 1 ? "reset credit" : "reset credits"} banked${
    expiresIn ? ` · next expires in ${expiresIn}` : ""
  }`;
}

export function ResetCredits({
  environmentId,
  input,
  credits,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
  readonly now: number;
}) {
  const { canManageProviders, confirming, setConfirming, busy, status, redeem } = useResetCredit(
    environmentId,
    input,
  );
  if (credits.availableCount === 0 && status === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="tabular-nums">{resetCreditsSummary(credits, now)}</span>
      {credits.availableCount > 0 ? (
        <Button
          size="xs"
          variant="outline"
          disabled={busy || !canManageProviders}
          onClick={() => {
            if (readEnvironmentScope(environmentId, AuthProvidersManageScope)) setConfirming(true);
          }}
        >
          {busy ? "Using…" : "Use reset"}
        </Button>
      ) : null}
      {status ? <span className="text-foreground">{status}</span> : null}
      <ResetCreditDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void redeem()}
        disabled={!canManageProviders}
      />
    </div>
  );
}

interface UsageLimitsHoverWindow {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsIn: string | null;
}

interface UsageLimitsHoverRow {
  readonly key: string;
  readonly driver: ServerProvider["driver"];
  readonly driverLabel: string;
  readonly instanceLabel: string;
  readonly accentColor: string | undefined;
  readonly notice: string | null;
  readonly windows: readonly UsageLimitsHoverWindow[];
}

/**
 * Flatten the primary environment's native-provider limits into rows that fit
 * in the sidebar hover. Remotes, source accounts, and actions stay on the page.
 */
export function buildUsageLimitsHoverRows(
  presentations: LimitPresentations,
  primaryEnvironmentId: EnvironmentId | null,
  now: number,
): readonly UsageLimitsHoverRow[] {
  if (primaryEnvironmentId === null) return [];
  const providers = presentations.get(primaryEnvironmentId)?.serverConfig?.providers ?? [];
  return providersWithLimits(providers).flatMap((provider) => {
    const limits = provider.usageLimits;
    if (!limits) return [];
    const driverLabel = providerClients.get(provider.driver)?.label ?? String(provider.driver);
    return [
      {
        key: `${primaryEnvironmentId}:${provider.instanceId}`,
        driver: provider.driver,
        driverLabel,
        instanceLabel: provider.displayName?.trim() || driverLabel,
        accentColor: provider.accentColor,
        notice: limitsNotice(limits),
        windows: limits.windows.map((window) => ({
          id: window.id,
          label: window.label,
          usedPercent: window.usedPercent,
          resetsIn: formatResetsIn(window, now),
        })),
      },
    ];
  });
}

/** Compact native-provider limits, without controls that cannot be used inside a tooltip. */
function UsageLimitsHoverContent({ rows }: { readonly rows: readonly UsageLimitsHoverRow[] }) {
  if (rows.length === 0) {
    return <p className="px-1 py-1.5 text-xs text-muted-foreground">No limits reported.</p>;
  }

  return (
    <div className="flex w-72 flex-col gap-3 p-1.5">
      {rows.map((row) => (
        <section key={row.key} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <ProviderInstanceIcon
              driverKind={row.driver}
              displayName={row.instanceLabel}
              accentColor={row.accentColor}
              showBadge={Boolean(row.accentColor)}
              indicatorBackground="var(--popover)"
              className="size-4"
              iconClassName="size-3.5 text-foreground/80"
            />
            <span className="shrink-0 font-medium text-foreground">{row.driverLabel}</span>
            {row.instanceLabel !== row.driverLabel ? (
              <span className="min-w-0 truncate text-muted-foreground">· {row.instanceLabel}</span>
            ) : null}
          </div>
          {row.notice ? (
            <p className="text-2xs text-muted-foreground">{row.notice}</p>
          ) : (
            row.windows.map((window) => {
              const used = Math.max(0, Math.min(100, window.usedPercent));
              const color = normalizeProviderAccentColor(row.accentColor) ?? barColor(row.driver);
              return (
                <div key={window.id} className="flex flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2 text-2xs">
                    <span className="min-w-0 truncate text-muted-foreground">{window.label}</span>
                    <span className="ms-auto shrink-0 font-medium tabular-nums" style={{ color }}>
                      {Math.round(used)}%
                    </span>
                    {window.resetsIn ? (
                      <span className="w-[5.75rem] shrink-0 text-right text-3xs text-muted-foreground tabular-nums">
                        {window.resetsIn}
                      </span>
                    ) : null}
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${used}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </section>
      ))}
    </div>
  );
}

/** Current Codex and Claude subscription headroom on the sidebar's Usage icon. */
export function UsageLimitsHoverCard() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [now] = useState(() => Date.now());
  return (
    <UsageLimitsHoverContent
      rows={buildUsageLimitsHoverRows(presentations, primaryEnvironmentId, now)}
    />
  );
}

/** Advance now only on explicit refresh to avoid page repaints from ticking. */
export function UsageLimitsSection({
  selectedEnvironmentIds,
  hiddenProviders,
  now,
  cursorPrompt,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly now: number;
  readonly cursorPrompt?: ReactNode;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const hiddenDrivers = new Set<ServerProvider["driver"]>(
    [...hiddenProviders].map((provider) => PROVIDER_PRESENTATION[provider].driverKind),
  );
  const isVisible = (driver: ServerProvider["driver"]) => !hiddenDrivers.has(driver);
  const selected = new Map(
    [...presentations].flatMap(([id, presentation]) => {
      if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(id)) return [];
      const config = presentation.serverConfig;
      if (hiddenDrivers.size === 0 || config === null) return [[id, presentation] as const];
      return [
        [
          id,
          {
            ...presentation,
            serverConfig: {
              ...config,
              providers: config.providers.filter((provider) => isVisible(provider.driver)),
              usageLimitSources: config.usageLimitSources?.flatMap((source) => {
                const accounts = source.accounts.filter((account) => isVisible(account.driver));
                return accounts.length === 0 && source.accounts.length > 0
                  ? []
                  : [{ ...source, accounts }];
              }),
            },
          },
        ] as const,
      ];
    }),
  );
  return <UsageLimitsPooled presentations={selected} now={now} cursorPrompt={cursorPrompt} />;
}
