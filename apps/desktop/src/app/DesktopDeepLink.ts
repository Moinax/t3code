import type { DesktopDeepLinkTarget } from "@t3tools/contracts";

// `t3code://threads/<environmentId>/<threadId>`, the contract mobile and widgets
// already use. Only this external shape is stable; the renderer route it maps to
// stays an implementation detail. Plain functions so URL edge cases test without
// an Electron or Effect runtime.

const DEEP_LINK_THREAD_HOST = "threads";

// Re-exported so main-process modules do not each reach into the contracts
// package for what is, from their side, this module's return type.
export type DeepLinkTarget = DesktopDeepLinkTarget;

// A decoded segment can still be empty, contain a separator or be whitespace when
// the link was hand-written or truncated. Reject rather than normalize: a
// wrong-but-plausible id would open someone else's thread.
function isCleanSegment(value: string): boolean {
  if (value.length === 0 || value.trim().length !== value.length) return false;
  return !/[/\\?#]/.test(value);
}

/**
 * Parses a deep link URL into a navigation target.
 *
 * Returns `null` for anything that is not a well-formed thread link, including
 * links using a different scheme, so callers can fall back to simply revealing
 * the window.
 */
export function parseDeepLink(rawUrl: string, schemes: readonly string[]): DeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  // `URL.protocol` keeps the trailing colon.
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (!schemes.some((candidate) => candidate.toLowerCase() === scheme)) {
    return null;
  }

  // `t3code://threads/<env>/<thread>` puts `threads` in the host position, not
  // in the path — the authority component absorbs the first segment.
  if (url.hostname.toLowerCase() !== DEEP_LINK_THREAD_HOST) {
    return null;
  }

  // Keep empty segments so doubled, leading, and trailing separators are
  // rejected instead of silently normalizing a malformed link.
  const segments = url.pathname.split("/").slice(1);
  if (segments.length !== 2) {
    return null;
  }

  let environmentId: string;
  let threadId: string;
  try {
    environmentId = decodeURIComponent(segments[0] ?? "");
    threadId = decodeURIComponent(segments[1] ?? "");
  } catch {
    // Malformed percent-encoding.
    return null;
  }

  if (!isCleanSegment(environmentId) || !isCleanSegment(threadId)) {
    return null;
  }

  return { kind: "thread", environmentId, threadId };
}

/**
 * The first deep link in an argv vector, where Windows and Linux deliver protocol
 * URLs on launch and through `second-instance`. macOS uses `open-url` instead.
 */
export function findDeepLinkInArgv(
  argv: readonly string[],
  schemes: readonly string[],
): string | null {
  for (const arg of argv) {
    if (typeof arg !== "string") continue;
    const trimmed = arg.trim();
    if (trimmed.length === 0) continue;
    if (!schemes.some((scheme) => trimmed.toLowerCase().startsWith(`${scheme.toLowerCase()}://`))) {
      continue;
    }
    return trimmed;
  }
  return null;
}
