import { ForkUpdateAction, ForkUpdateState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

declare const __T3CODE_FORK_UPDATE_RUNNER__: string;

class ForkUpdateError extends Schema.TaggedErrorClass<ForkUpdateError>()("ForkUpdateError", {
  message: Schema.String,
}) {}
const RunnerState = Schema.Struct({
  ...ForkUpdateState.fields,
  available: Schema.optionalKey(Schema.Boolean),
  runningVersion: Schema.optionalKey(Schema.String),
});
const decodeRunnerState = Schema.decodeUnknownEffect(Schema.fromJsonString(RunnerState));
export const forkUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FORK_UPDATE_CHANNEL,
  payload: ForkUpdateAction,
  result: ForkUpdateState,
  handler: Effect.fn("desktop.ipc.forkUpdate")(function* (action) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const app = yield* ElectronApp.ElectronApp;
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const repo =
      process.env.T3CODE_REPO ||
      environment.path.join(environment.homeDirectory, "Projects/labs/t3code");
    const scriptDirectory = environment.path.join(environment.homeDirectory, ".local/state/t3fork");
    const script = environment.path.join(scriptDirectory, `client-${environment.appVersion}.mjs`);
    const available =
      environment.platform === "linux" &&
      /-moinax\./.test(environment.appVersion) &&
      (yield* fs.exists(environment.path.join(repo, ".git")));
    if (!available) {
      return {
        available: false,
        stage: "idle" as const,
        message: "Fork preparation requires the local Linux fork installation.",
        updatedAt: 0,
        commit: null,
        version: null,
        runningVersion: environment.appVersion,
        runId: null,
        workDir: null,
        attempt: 0,
        log: "",
      };
    }
    yield* fs.makeDirectory(scriptDirectory, { recursive: true, mode: 0o700 });
    if (!(yield* fs.exists(script)))
      yield* fs.writeFileString(script, __T3CODE_FORK_UPDATE_RUNNER__, { mode: 0o600 });
    const output = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make(
            process.execPath,
            [script, action, environment.appVersion, String(process.pid)],
            {
              env: { ELECTRON_RUN_AS_NODE: "1" },
              extendEnv: true,
              stdin: "ignore",
            },
          ),
        );
        const text = yield* child.all.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (all, chunk) => (all + chunk).slice(-128 * 1024),
          ),
        );
        const code = yield* child.exitCode;
        if (code !== ChildProcessSpawner.ExitCode(0))
          return yield* new ForkUpdateError({ message: text.trim() || "The fork updater failed." });
        return text;
      }),
    ).pipe(Effect.timeout("30 seconds"));
    const raw = yield* decodeRunnerState(output);
    const state = { ...raw, available: true, runningVersion: environment.appVersion };
    if (action === "restart") yield* app.quit;
    return state;
  }),
});
