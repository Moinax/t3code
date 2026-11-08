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
import { resetCreditFailureText } from "@t3tools/client-runtime/state/usage";
import {
  providersWithLimits,
  type LimitPresentations,
  type LimitPace,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
  type ResetCreditChoice,
} from "@t3tools/shared/usageLimits";
import { GaugeIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { Fragment, useLayoutEffect, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import type { MessageResolver } from "../../i18n/messages";
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
import { UsageLimitsPooled } from "./UsageLimitsPooled";
import { formatResetsIn, limitsNotice, resetCreditChoices } from "@t3tools/shared/usageLimitsCopy";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { SharedTooltipTrigger } from "../ui/shared-tooltip";

const PACE: Record<LimitPace, { readonly label: string; readonly icon: typeof GaugeIcon }> = {
  ahead: {
    label: msg("Ahead of pace: spending faster than the window elapses"),
    icon: TrendingUpIcon,
  },
  on: { label: msg("On pace with the window"), icon: GaugeIcon },
  under: {
    label: msg("Under pace: headroom left for the rest of the window"),
    icon: TrendingDownIcon,
  },
};

export function barColor(driver: ServerProvider["driver"]): string {
  const presentation = Object.values(PROVIDER_PRESENTATION).find(
    (entry) => entry.driverKind === driver,
  );
  return presentation?.color ?? "var(--foreground)";
}

export function PaceIcon({ pace }: { readonly pace: LimitPace }) {
  const Icon = PACE[pace].icon;
  const m = useMessages();
  return (
    <SharedTooltipTrigger
      render={
        <span
          role="img"
          aria-label={m(PACE[pace].label)}
          className="inline-flex text-muted-foreground"
        />
      }
      label={m(PACE[pace].label)}
    >
      <Icon className="size-3.5" aria-hidden />
    </SharedTooltipTrigger>
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
  const gt = useGT();
  const m = useMessages();
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const [barRef, paceMark] = usePaceMark(timeLeft);
  const resetsIn = formatResetsIn(window, now, m);
  const resetsAt = window.resetsAt
    ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m)
    : null;
  const label = window.label;
  const summary =
    timeLeft === null
      ? resetsIn
        ? gt("{label}: {remaining}% left, {resetsIn}", { label, remaining, resetsIn })
        : gt("{label}: {remaining}% left", { label, remaining })
      : resetsIn
        ? gt("{label}: {remaining}% left, {timeLeft}% of the window left, {resetsIn}", {
            label,
            remaining,
            timeLeft,
            resetsIn,
          })
        : gt("{label}: {remaining}% left, {timeLeft}% of the window left", {
            label,
            remaining,
            timeLeft,
          });

  return (
    <SharedTooltipTrigger
      render={
        <div
          ref={barRef}
          role="img"
          aria-label={summary}
          tabIndex={0}
          className="relative h-6 cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      }
      label={
        <>
          <div className="flex flex-col gap-0.5">
            <span className="text-foreground">
              {timeLeft !== null
                ? gt("{remaining}% left · {timeLeft}% of the window left", { remaining, timeLeft })
                : gt("{remaining}% left", { remaining })}
            </span>
            {timeLeft !== null ? (
              <span className="text-muted-foreground">
                <T>The line is where even spending would be.</T>
              </span>
            ) : null}
            {resetsAt ? (
              <span className="text-muted-foreground">
                {resetsIn
                  ? gt("Resets {resetsAt} · {resetsIn}", { resetsAt, resetsIn })
                  : gt("Resets {resetsAt}", { resetsAt })}
              </span>
            ) : null}
          </div>
        </>
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
    </SharedTooltipTrigger>
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
  const gt = useGT();
  const m = useMessages();
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
        const resetsIn = formatResetsIn(window, now, m);
        return (
          <Fragment key={window.id}>
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{window.label}</span>
              <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
                {gt("{remaining}% left", { remaining: remainingPercent(window) })}
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
  reset: msg("Reset applied. Your windows have cleared."),
  nothingToReset: msg("Nothing to reset right now."),
  noCredit: msg("No reset credit left."),
  alreadyRedeemed: msg("That credit was already redeemed."),
};

export function useResetCredit(environmentId: EnvironmentId) {
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, { reportFailure: false });
  const m = useMessages();
  // Kept after close so the dialog's text survives its exit animation.
  const [choice, setChoice] = useState<ResetCreditChoice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const redeem = async () => {
    setConfirming(false);
    if (!choice || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setBusy(true);
    setStatus(null);
    const result = await consume({ environmentId, input: choice.input });
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value.warning ?? m(OUTCOME_TEXT[result.value.outcome]));
      return;
    }
    setStatus(resetCreditFailureText(result, m));
  };

  const confirm = (next: ResetCreditChoice) => {
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setChoice(next);
    setConfirming(true);
  };

  return { canManageProviders, choice, confirming, setConfirming, confirm, busy, status, redeem };
}

/** Require confirmation because redemption spends credits. Mount outside popovers, which stack above
 * dialogs and unmount on close. */
export function ResetCreditDialog({
  open,
  onOpenChange,
  choice,
  onConfirm,
  disabled = false,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly choice: ResetCreditChoice | null;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>Use a reset credit?</T>
          </AlertDialogTitle>
          <AlertDialogDescription>{choice?.confirmDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          <Button disabled={disabled} onClick={onConfirm}>
            <T>Use credit</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
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
  const { canManageProviders, choice, confirming, setConfirming, confirm, busy, status, redeem } =
    useResetCredit(environmentId);
  const gt = useGT();
  const m = useMessages();
  if (credits.availableCount === 0 && status === null) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {resetCreditChoices(credits, input, now, false, m).map((choice) => (
        <div key={choice.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular-nums">{choice.summary}</span>
          {choice.availableCount > 0 ? (
            <Button
              size="xs"
              variant="outline"
              disabled={busy || !canManageProviders}
              onClick={() => confirm(choice)}
            >
              {busy ? gt("Using…") : choice.actionLabel}
            </Button>
          ) : null}
        </div>
      ))}
      {status ? <span className="text-foreground">{status}</span> : null}
      <ResetCreditDialog
        open={confirming}
        onOpenChange={setConfirming}
        choice={choice}
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
  resolve?: MessageResolver,
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
        notice: limitsNotice(limits, resolve),
        windows: limits.windows.map((window) => ({
          id: window.id,
          label: window.label,
          usedPercent: window.usedPercent,
          resetsIn: formatResetsIn(window, now, resolve),
        })),
      },
    ];
  });
}

/** Compact native-provider limits, without controls that cannot be used inside a tooltip. */
function UsageLimitsHoverContent({ rows }: { readonly rows: readonly UsageLimitsHoverRow[] }) {
  const gt = useGT();
  if (rows.length === 0) {
    return <p className="px-1 py-1.5 text-xs text-muted-foreground">{gt("No limits reported.")}</p>;
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
              size="compact"
              className="size-4"
              iconClassName="text-foreground/80"
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
                    <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
                      {Math.round(used)}%
                    </span>
                    <span className="w-[5.75rem] shrink-0 text-right text-3xs text-muted-foreground tabular-nums">
                      {window.resetsIn}
                    </span>
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
  const m = useMessages();
  const [now] = useState(() => Date.now());
  return (
    <UsageLimitsHoverContent
      rows={buildUsageLimitsHoverRows(presentations, primaryEnvironmentId, now, m)}
    />
  );
}

/** Advance now only on explicit refresh to avoid page repaints from ticking. */
export function UsageLimitsSection({
  selectedEnvironmentIds,
  hiddenProviders,
  now,
}: {
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly now: number;
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
  return <UsageLimitsPooled presentations={selected} now={now} />;
}
