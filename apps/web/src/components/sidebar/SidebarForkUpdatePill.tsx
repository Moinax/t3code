import { isForkUpdateRunning, type ForkUpdateState } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
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

export function SidebarForkUpdatePill() {
  const state = useForkMaintenance((store) => store.state);
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  if (!state?.available || !isForkUpdateRunning(state.stage)) return null;
  const label = `${state.source === "local" ? "Local" : "Fork"}: ${stages[state.stage] ?? state.message}`;
  return (
    <SidebarUpdateNotice tone="loading">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`${label} Open update activity`}
              className="sidebar-update-main relative flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/fork-updates" });
              }}
            >
              <DownloadIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span role="status" className="truncate">
                {label}
              </span>
            </button>
          }
        />
        <TooltipPopup side="top">{state.message}</TooltipPopup>
      </Tooltip>
    </SidebarUpdateNotice>
  );
}
