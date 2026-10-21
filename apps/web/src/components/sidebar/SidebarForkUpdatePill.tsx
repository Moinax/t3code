import { getForkUpdatePreparedVersion, isForkUpdateRunning } from "@t3tools/contracts";
import type { ForkUpdateState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, DownloadIcon, TriangleAlertIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import { useForkMaintenance } from "../../state/forkMaintenance";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarUpdateNotice } from "./SidebarUpdateNotice";

const stages: Partial<Record<ForkUpdateState["stage"], string>> = {
  starting: "starting…",
  snapshotting: "preparing files…",
  fetching: "fetching changes…",
  rebasing: "integrating changes…",
  repairing: "repairing changes…",
  checking: "running checks…",
  building: "building app…",
  publishing: "publishing update…",
  installing: "installing app…",
};

const SEEN_VERSION_KEY = "t3code.fork.seenVersion";
/**
 * How long the arrival notice stays. Long enough to read and click through to
 * what changed, short enough that the sidebar is back to its quiet self before
 * it becomes part of the furniture — the state it reports is not actionable.
 */
const ARRIVAL_MS = 20_000;

// Through the shared helpers, which fall back to an in-memory store where
// `localStorage` is unavailable or blocked. Swallowed on top of that because
// this is a cosmetic notice: a stored value that no longer decodes must not
// take the sidebar down with it.
const readSeenVersion = () => {
  try {
    return getLocalStorageItem(SEEN_VERSION_KEY, Schema.String);
  } catch {
    return null;
  }
};
const writeSeenVersion = (version: string) => {
  try {
    setLocalStorageItem(SEEN_VERSION_KEY, version, Schema.String);
  } catch {
    // Nothing to do: the notice shows once more next time, at worst.
  }
};

/**
 * Whether this window just came up on a build it had not run before. The updater cannot tell
 * once restarted, so the window remembers the last version it saw; a first run only records it.
 */
function useJustUpdated(version: string | undefined): boolean {
  // Read before any version is known, because the answer is about the version
  // this window last ran, and the effect below is about to overwrite it.
  const [seen] = useState(readSeenVersion);
  const [expired, setExpired] = useState(false);
  const arrived = !expired && !!version && !!seen && seen !== version;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the running version in localStorage for the next launch
  useEffect(() => {
    if (version) writeSeenVersion(version);
  }, [version]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that retires the just-updated notice
  useEffect(() => {
    if (!arrived) return;
    const timer = setTimeout(() => setExpired(true), ARRIVAL_MS);
    return () => clearTimeout(timer);
  }, [arrived]);
  return arrived;
}

interface Notice {
  readonly tone: "loading" | "success" | "error";
  readonly icon: ReactNode;
  readonly label: string;
  readonly tip: string;
  readonly action?: { readonly label: string; readonly run: () => void };
}

export function SidebarForkUpdatePill() {
  const state = useForkMaintenance((store) => store.state);
  const pending = useForkMaintenance((store) => store.pending);
  const request = useForkMaintenance((store) => store.request);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const justUpdated = useJustUpdated(state?.available ? state.runningVersion : undefined);
  const openForkUpdates = () => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/fork-updates" });
  };

  const notice = describe();
  if (!notice) return null;

  function describe(): Notice | null {
    if (!state?.available) return null;
    const preparedVersion = getForkUpdatePreparedVersion(state);
    if (isForkUpdateRunning(state.stage))
      return {
        tone: "loading",
        icon: <DownloadIcon aria-hidden="true" className="size-3.5 shrink-0" />,
        label: `${state.source === "local" ? "Local" : "Fork"}: ${stages[state.stage] ?? state.message}`,
        tip: state.message,
      };
    if (preparedVersion && preparedVersion !== state.runningVersion)
      return {
        tone: "success",
        icon: <DownloadIcon aria-hidden="true" className="size-3.5 shrink-0" />,
        label: state.preparedSource === "local" ? "Local build ready" : "Update ready",
        tip: `${preparedVersion} is installed and waiting. Restarting takes a few seconds.`,
        action: { label: "Restart", run: () => void request("restart") },
      };
    if (state.stage === "error")
      return {
        tone: "error",
        icon: <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />,
        label: "Fork update failed",
        tip: state.message,
      };
    if (justUpdated)
      return {
        tone: "success",
        icon: <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />,
        label: `Now on ${state.targetTag ?? state.runningVersion}`,
        tip: "This build is new since you last ran the app.",
        action: { label: "Changes", run: openForkUpdates },
      };
    return null;
  }

  return (
    <SidebarUpdateNotice tone={notice.tone}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`${notice.label}. Open update activity`}
              data-update-main
              className="relative flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
              onClick={openForkUpdates}
            >
              {notice.icon}
              <span role="status" className="truncate">
                {notice.label}
              </span>
            </button>
          }
        />
        <TooltipPopup side="top">{notice.tip}</TooltipPopup>
      </Tooltip>
      {notice.action && (
        <button
          type="button"
          disabled={pending}
          className="mr-1 shrink-0 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring"
          onClick={notice.action.run}
        >
          {notice.action.label}
        </button>
      )}
    </SidebarUpdateNotice>
  );
}
