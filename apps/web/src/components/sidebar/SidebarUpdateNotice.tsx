import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const tones = {
  loading:
    "bg-sidebar-control-surface text-sidebar-foreground group-has-[button.sidebar-update-main:hover]/update-notice:bg-sidebar-row-hover",
  success:
    "bg-sidebar-control-surface text-sidebar-foreground group-has-[button.sidebar-update-main:hover]/update-notice:bg-sidebar-row-hover",
  warning:
    "bg-warning/12 text-warning group-has-[button.sidebar-update-main:hover]/update-notice:bg-warning/18",
  error:
    "bg-destructive/12 text-destructive group-has-[button.sidebar-update-main:hover]/update-notice:bg-destructive/18",
};

export function SidebarUpdateNotice({
  tone,
  className,
  ...props
}: ComponentProps<"div"> & { tone: keyof typeof tones }) {
  return (
    <div
      {...props}
      className={cn(
        "group/update-notice relative flex min-h-7 w-full shrink-0 items-center overflow-hidden rounded-lg text-[11px] leading-4 font-medium",
        tones[tone],
        className,
      )}
    />
  );
}
