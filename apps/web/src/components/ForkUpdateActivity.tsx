import { ArrowDownIcon, CheckIcon, ChevronRightIcon, CopyIcon, WrapTextIcon } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { parseAnsiLog } from "../lib/ansiLog";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export function ForkUpdateActivity({
  log,
  running,
  defaultOpen,
}: {
  log: string;
  running: boolean;
  defaultOpen: boolean;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [wrap, setWrap] = useState(true);
  const [following, setFollowing] = useState(true);
  const [copyError, setCopyError] = useState<string | null>(null);
  const viewport = useRef<HTMLPreElement>(null);
  const entries = useMemo(() => parseAnsiLog(log), [log]);
  const plainText = entries.map((entry) => entry.text).join("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "update activity",
    onCopy: () => setCopyError(null),
    onError: () => setCopyError("Could not copy the log. Select the text to copy it manually."),
  });

  useLayoutEffect(() => {
    if (open && following && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
    // Content and wrapping change the scroll height after React commits the log.
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [log, open, following, wrap]);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 bg-muted/30 px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
      >
        <ChevronRightIcon aria-hidden="true" className={cn("size-3.5", open && "rotate-90")} />
        Update activity
        {running && (
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            Running
          </span>
        )}
      </button>
      <div id={contentId} hidden={!open}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border bg-muted/15 px-3 py-1.5">
          <span className="text-xs text-muted-foreground">
            {following && running ? "Following latest output" : "Recent output"}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              aria-pressed={wrap}
              className={wrap ? "bg-accent" : undefined}
              onClick={() => setWrap(!wrap)}
            >
              <WrapTextIcon aria-hidden="true" />
              Wrap lines
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!plainText || isCopied}
              onClick={() => copyToClipboard(plainText)}
            >
              {isCopied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {isCopied ? "Copied" : "Copy log"}
            </Button>
          </div>
        </div>
        {copyError && (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            {copyError}
          </p>
        )}
        <pre
          ref={viewport}
          tabIndex={0}
          aria-label="Recent update output"
          onScroll={(event) => {
            if (!open) return;
            const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
            setFollowing(scrollHeight - scrollTop - clientHeight < 24);
          }}
          className={cn(
            "max-h-[min(32rem,60vh)] min-h-32 overflow-auto overscroll-contain bg-background/60 p-4 font-mono text-xs leading-5 text-foreground [overflow-anchor:none] focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
            wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          )}
        >
          {plainText
            ? entries.map((entry) => (
                <span key={entry.offset} style={entry.style}>
                  {entry.text}
                </span>
              ))
            : "Waiting for output…"}
        </pre>
        <div className="flex justify-end border-t border-border bg-muted/15 px-3 py-1.5">
          <Button
            size="xs"
            variant="ghost"
            className={following ? "invisible" : undefined}
            disabled={following}
            onClick={() => setFollowing(true)}
          >
            <ArrowDownIcon aria-hidden="true" />
            Jump to latest
          </Button>
        </div>
      </div>
    </div>
  );
}
