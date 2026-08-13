// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopDeepLink from "./DesktopDeepLink.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

// Delivers `t3code://` links to the renderer.
//
// The two platforms hand the URL over differently:
//   * macOS emits `open-url` — the URL never appears in argv.
//   * Windows/Linux pass it as a command-line argument, both on first launch
//     and, for an already-running app, via `second-instance`.
//
// Both paths funnel into the same DesktopWindow.dispatchDeepLink, which owns
// window creation, the wait for the first renderer load, and the hold-until-
// backend-ready behaviour.

const { logInfo, logWarning } = makeComponentLogger("desktop-deep-link-router");

/**
 * Path of the local socket a link can be handed to directly.
 *
 * `XDG_RUNTIME_DIR` is the right home: it is user-owned, 0700, and cleared on
 * logout, so a stale socket cannot outlive the session that made it. Falling
 * back to the temp dir keeps this working where the variable is unset — there
 * the 0600 mode below is what carries the ownership check.
 */
export function deepLinkSocketPath(input: {
  readonly isDevelopment: boolean;
  readonly runtimeDir: string | undefined;
  readonly tmpDir: string;
  readonly uid: number;
}): string {
  // Derived from the protocol scheme so the dev/prod channel split is defined
  // once: a caller that knows which scheme it writes knows which socket too.
  const name = `${ElectronProtocol.getDesktopScheme(input.isDevelopment)}-deeplink.sock`;
  const directory = input.runtimeDir?.trim();
  return directory !== undefined && directory.length > 0
    ? NodePath.join(directory, name)
    : // No per-user runtime dir, so the uid goes in the name: /tmp is shared, and
      // two users must not race for the same path.
      NodePath.join(input.tmpDir, `${input.uid}-${name}`);
}

export class DeepLinkSocketError extends Schema.TaggedErrorClass<DeepLinkSocketError>()(
  "DeepLinkSocketError",
  {
    socketPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to open the deep link socket at ${this.socketPath}.`;
  }
}

export class DesktopDeepLinkRouter extends Context.Service<
  DesktopDeepLinkRouter,
  {
    readonly register: Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/app/DesktopDeepLinkRouter") {}

export const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const context = yield* Effect.context<DesktopWindow.DesktopWindow>();
  const runPromise = Effect.runPromiseWith(context);

  const schemes = [ElectronProtocol.getDesktopScheme(environment.isDevelopment)];

  const handle = (
    rawUrl: string,
    source: "open-url" | "second-instance" | "launch-argv" | "socket",
  ) => {
    const target = DesktopDeepLink.parseDeepLink(rawUrl, schemes);
    if (target === null) {
      // Not ours to act on: OAuth callbacks and the renderer bundle URL also
      // use this scheme, and they are handled elsewhere.
      return;
    }
    void runPromise(
      Effect.gen(function* () {
        yield* logInfo("received deep link", { source, kind: target.kind });
        yield* desktopWindow.dispatchDeepLink(target);
      }).pipe(
        // A malformed link must never take down the app.
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to dispatch deep link", { source, cause }),
        ),
      ),
    );
  };

  // A local listener so a link can skip the desktop's URL routing entirely.
  //
  // Going through `xdg-open` means launching a whole second copy of the app
  // whose only job is to take the single-instance lock, hand the URL over and
  // die: measured at ~1.4s here, half of it the AppImage's squashfs mount. A
  // caller that already runs on this machine — a status bar, a notification
  // daemon, a hotkey — can write the same URL here and be done in microseconds.
  //
  // The socket is the authentication: 0600 in a user-owned directory means only
  // this user can write to it, which is the same trust boundary `xdg-open`
  // already assumes. Nothing is read back, and the only reachable action is the
  // one `handle` already performs for links from anywhere else.
  const listenOnSocket = Effect.gen(function* () {
    const socketPath = deepLinkSocketPath({
      isDevelopment: environment.isDevelopment,
      runtimeDir: process.env.XDG_RUNTIME_DIR,
      tmpDir: NodeOS.tmpdir(),
      uid: process.getuid?.() ?? 0,
    });

    const server = yield* Effect.acquireRelease(
      Effect.sync(() => {
        // A crash leaves the socket file behind and `listen` would refuse to
        // bind. Only the single instance holding the lock reaches this, so
        // whatever is there is ours and stale.
        try {
          NodeFS.unlinkSync(socketPath);
        } catch {
          // Nothing to clear.
        }
        const created = NodeNet.createServer((connection) => {
          connection.setEncoding("utf8");
          let received = "";
          // One URL per connection, first line wins: a caller that opens the
          // socket and stalls must not be able to grow this buffer forever.
          connection.on("data", (chunk: string) => {
            received += chunk;
            if (received.length > 4096 || received.includes("\n")) {
              connection.end();
            }
          });
          connection.on("close", () => {
            const url = received.split("\n", 1)[0]?.trim() ?? "";
            if (url.length > 0) handle(url, "socket");
          });
          connection.on("error", () => connection.destroy());
        });
        created.on("error", () => {
          // Never fatal: losing this listener costs speed, not function —
          // `xdg-open` still routes the same links.
        });
        return created;
      }),
      (created) =>
        Effect.sync(() => {
          created.close();
          try {
            NodeFS.unlinkSync(socketPath);
          } catch {
            // Already gone.
          }
        }),
    );

    yield* Effect.callback<void, DeepLinkSocketError>((resume) => {
      let settled = false;
      const finish = (result: Effect.Effect<void, DeepLinkSocketError>) => {
        if (settled) return;
        settled = true;
        resume(result);
      };
      // The socket must never be observable with open permissions: in the
      // /tmp fallback the directory is shared, and chmod-after-listen leaves
      // a window where another user could connect. umask makes it be born
      // owner-only; restored as soon as listen settles.
      const previousUmask = process.umask(0o077);
      server.listen(socketPath, () => {
        process.umask(previousUmask);
        try {
          NodeFS.chmodSync(socketPath, 0o600);
          finish(Effect.void);
        } catch (error) {
          // A socket we cannot lock down is worse than none: close it rather
          // than leave a world-writable entry point to window navigation.
          server.close();
          finish(Effect.fail(new DeepLinkSocketError({ socketPath, cause: error })));
        }
      });
      server.once("error", (error) => {
        process.umask(previousUmask);
        finish(Effect.fail(new DeepLinkSocketError({ socketPath, cause: error })));
      });
    });

    yield* logInfo("listening for deep links", { socketPath });
  }).pipe(
    Effect.catchCause((cause) =>
      logWarning("could not open the deep link socket; falling back to URL routing", { cause }),
    ),
  );

  const register = Effect.gen(function* () {
    yield* listenOnSocket;

    // Typed structurally so this module keeps talking to Electron only through
    // the ElectronApp service, as the rest of the app does.
    yield* electronApp.on<[{ preventDefault: () => void }, string]>("open-url", (event, url) => {
      event.preventDefault();
      handle(url, "open-url");
    });

    // A second `second-instance` listener alongside the one that reveals the
    // window: Electron invokes every registered listener, so window reveal and
    // link routing stay owned by their respective modules.
    yield* electronApp.on<[unknown, readonly string[], string]>(
      "second-instance",
      (_event, argv) => {
        const url = DesktopDeepLink.findDeepLinkInArgv(argv ?? [], schemes);
        if (url !== null) handle(url, "second-instance");
      },
    );

    // Windows/Linux cold start: the link that launched the app is already in
    // our own argv, and no event will ever be emitted for it.
    const launchUrl = DesktopDeepLink.findDeepLinkInArgv(process.argv, schemes);
    if (launchUrl !== null) {
      handle(launchUrl, "launch-argv");
    }
  }).pipe(Effect.withSpan("desktop.deepLinkRouter.register"));

  return DesktopDeepLinkRouter.of({ register });
});

export const layer = Layer.effect(DesktopDeepLinkRouter, make);
