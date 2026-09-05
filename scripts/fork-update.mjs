#!/usr/bin/env node
// Standalone on purpose: a running update must survive rebuilding/rebasing the app.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const terminal = new Set(["idle", "ready", "error", "cancelled"]);
const unit = "t3fork-update.service";
export const defaults = () => ({
  repo: process.env.T3CODE_REPO || NodePath.join(NodeOS.homedir(), "Projects/labs/t3code"),
  stateDir: NodePath.join(NodeOS.homedir(), ".local/state/t3fork"),
  target: NodePath.join(NodeOS.homedir(), ".local/share/AppImages/t3-code.AppImage"),
  origin: "https://github.com/Moinax/t3code.git",
  upstream: "https://github.com/pingdotgg/t3code.git",
  branch: "moinax",
});
const empty = () => ({
  stage: "idle",
  message: "Ready to check for an update.",
  updatedAt: Date.now(),
  commit: null,
  version: null,
  runId: null,
  workDir: null,
  attempt: 0,
});
export function readState(config) {
  try {
    return JSON.parse(NodeFS.readFileSync(NodePath.join(config.stateDir, "status.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return empty();
    throw error;
  }
}
export function saveState(config, state) {
  NodeFS.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const file = NodePath.join(config.stateDir, "status.json");
  const temp = `${file}.${NodeCrypto.randomUUID()}`;
  NodeFS.writeFileSync(temp, JSON.stringify({ ...state, updatedAt: Date.now() }), { mode: 0o600 });
  NodeFS.renameSync(temp, file);
}
async function digest(file) {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function active() {
  const { stdout } = await exec("systemctl", [
    "--user",
    "show",
    unit,
    "--property=ActiveState",
    "--value",
  ]);
  return ["active", "activating", "reloading", "deactivating"].includes(stdout.trim());
}
export function reconcileState(state, running) {
  if (running && terminal.has(state.stage))
    return { ...state, stage: "starting", message: "Starting update…" };
  if (!running && !terminal.has(state.stage))
    return {
      ...state,
      stage: "error",
      message: "The update stopped before finishing. Check the log and retry.",
    };
  return state;
}
export async function status(config) {
  const saved = readState(config);
  const state = reconcileState(saved, await active());
  if (state.stage !== saved.stage && state.stage === "error") saveState(config, state);
  let log = "";
  if (state.runId && /^[a-f0-9-]+$/.test(state.runId)) {
    // Bounded tail, even if a build or agent has produced a large log.
    const { stdout } = await exec("tail", [
      "-c",
      "16000",
      NodePath.join(config.stateDir, `${state.runId}.log`),
    ]).catch(() => ({ stdout: "" }));
    log = stdout;
  }
  if (state.stage === "ready") {
    const installed = await NodeFSP.stat(config.target).catch(() => null);
    if (
      !installed ||
      installed.size !== state.installedSize ||
      installed.mtimeMs !== state.installedMtimeMs
    ) {
      const invalid = {
        ...state,
        stage: "error",
        message: "The installed AppImage changed or is missing. Prepare the update again.",
      };
      saveState(config, invalid);
      return { ...invalid, log };
    }
  }
  return { ...state, log };
}

export function commandRunner(logFile) {
  return (command, args, options = {}) =>
    new Promise((resolveCommand, reject) => {
      NodeFS.appendFileSync(
        logFile,
        `\n$ ${command} ${args[0] === "exec" ? "exec [repair instructions]" : args.join(" ")}\n`,
      );
      const child = NodeChildProcess.spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      let pending = "";
      const record = (chunk) => {
        const value = chunk.toString();
        output = (output + value).slice(-24000);
        if (!options.agent) {
          NodeFS.appendFileSync(logFile, value);
          return;
        }
        pending += value;
        const lines = pending.split("\n");
        pending = lines.pop().slice(-100000);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            const item = event.item;
            const message =
              item?.type === "agent_message"
                ? item.text
                : item?.type === "command_execution"
                  ? `${event.type}: ${item.command}`
                  : event.type === "error"
                    ? event.message
                    : null;
            if (message) NodeFS.appendFileSync(logFile, `${message}\n`);
          } catch {
            NodeFS.appendFileSync(logFile, `${line}\n`);
          }
        }
      };
      child.stdout.on("data", record);
      child.stderr.on("data", record);
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolveCommand(output.trim())
          : reject(new Error(`${command} failed (${code}).\n${output.slice(-6000)}`)),
      );
    });
}

export function affectedTests(changed, prefix, root) {
  const candidates = changed
    .filter((file) => file.startsWith(prefix))
    .flatMap((file) => {
      if (/\.test\.tsx?$/.test(file)) return [file];
      if (!/\.tsx?$/.test(file)) return [];
      const base = file.replace(/\.tsx?$/, "");
      return [`${base}.test.ts`, `${base}.test.tsx`];
    });
  return [...new Set(candidates)]
    .filter((file) => NodeFS.existsSync(NodePath.join(root, file)))
    .map((file) => file.slice(prefix.length));
}

export async function prepareUpdate(config, run, report, tools) {
  const git = (args, cwd = config.workDir) => run("git", args, { cwd });
  report({ stage: "fetching", message: "Fetching the published fork and upstream…" });
  // Start from the published fork. Local unpublished commits must never be silently discarded.
  await run("git", [
    "clone",
    "--reference-if-able",
    config.repo,
    "--dissociate",
    "--single-branch",
    "--branch",
    config.branch,
    config.origin,
    config.workDir,
  ]);
  const original = await git(["rev-parse", "HEAD"]);
  const localHead = await git(["rev-parse", `refs/heads/${config.branch}`], config.repo);
  if (
    localHead !== original &&
    !(config.published?.commit === original && config.published?.sourceCommit === localHead)
  )
    throw new Error(
      "The local fork has unpublished or divergent commits. Synchronize and publish them before updating.",
    );
  await git(["config", "user.name", await git(["config", "user.name"], config.repo)]);
  await git(["config", "user.email", await git(["config", "user.email"], config.repo)]);
  // The runner owns publication. An agent's ordinary git push cannot publish this checkout.
  await git(["remote", "set-url", "--push", "origin", "DISABLED"]);
  await git(["remote", "add", "upstream", config.upstream]);
  await git(["fetch", "upstream", "main"]);
  const upstream = await git(["rev-parse", "refs/remotes/upstream/main"]);
  const missing = await git(["rev-list", "--count", `${original}..${upstream}`]);
  if (missing === "0" && config.runningCommit && original.startsWith(config.runningCommit)) {
    report({ stage: "idle", message: "The running app is up to date." });
    return;
  }
  let attempt = 0;
  const repair = async (error) => {
    if (++attempt > 2)
      throw new Error(
        `Automatic repair did not pass verification after two attempts. ${error.message}`,
      );
    report({
      stage: "repairing",
      attempt,
      message: `Sol High Fast is fixing the update, attempt ${attempt}/2…`,
    });
    await run(
      tools.codex,
      [
        "exec",
        "--json",
        "--ignore-user-config",
        "-m",
        "gpt-5.6-sol",
        "-c",
        'model_reasoning_effort="high"',
        "-c",
        'service_tier="fast"',
        "-c",
        'approval_policy="never"',
        "-c",
        'default_permissions="fork_update"',
        "-c",
        `permissions={fork_update={extends=":workspace",filesystem={${JSON.stringify(NodePath.join(config.workDir, ".git"))}="write"},network={enabled=true}}}`,
        `Maintain this T3 Code fork after rebasing onto upstream ${upstream}. Resolve all rebase conflicts and finish the rebase, then fix integration errors. Preserve the intent of every custom fork patch. Read AGENTS.md. Do not delete tests or weaken checks to make them pass. Do not push, install, restart, modify other checkouts, or spawn other agents. Do not run repo-wide tests/typechecks or launch browsers. The runner performs scoped checks and builds after you finish. Commit your fixes with a conventional commit. If a change needs a human decision, explain it and leave the checkout unready. Failure details:\n${error.message.slice(-6000)}`,
      ],
      { cwd: config.workDir, agent: true },
    );
  };
  report({ stage: "rebasing", message: `Rebasing ${missing} upstream commits…` });
  try {
    await git(["rebase", upstream]);
  } catch (error) {
    await repair(error);
  }
  let artifact;
  let commit;
  let version;
  for (;;) {
    try {
      for (const dir of ["rebase-merge", "rebase-apply"]) {
        const path = await git(["rev-parse", "--path-format=absolute", "--git-path", dir]);
        if (NodeFS.existsSync(path)) throw new Error("The rebase is still in progress.");
      }
      await git(["merge-base", "--is-ancestor", upstream, "HEAD"]);
      if (await git(["status", "--porcelain"]))
        throw new Error("The repair left uncommitted changes.");
      report({
        stage: "checking",
        message: "Installing dependencies and checking the desktop, web and server…",
      });
      await run(tools.vp, ["install", "--frozen-lockfile"], { cwd: config.workDir });
      const changed = (await git(["diff", "--name-only", original, "HEAD"])).split("\n");
      for (const workspace of ["web", "server", "desktop"]) {
        const cwd = NodePath.join(config.workDir, "apps", workspace);
        await run(tools.vp, ["run", "typecheck"], { cwd });
        const tests = affectedTests(changed, `apps/${workspace}/`, config.workDir);
        if (tests.length) await run(tools.vp, ["test", "run", ...tests], { cwd });
      }
      const packages = new Set(
        changed.filter((file) => file.startsWith("packages/")).map((file) => file.split("/")[1]),
      );
      for (const name of packages) {
        const tests = affectedTests(changed, `packages/${name}/`, config.workDir);
        if (tests.length)
          await run(tools.vp, ["test", "run", ...tests], {
            cwd: NodePath.join(config.workDir, "packages", name),
          });
      }
      if (NodeFS.existsSync(NodePath.join(config.workDir, "scripts/fork-update.test.mjs"))) {
        await run(process.execPath, ["--test", "scripts/fork-update.test.mjs"], {
          cwd: config.workDir,
        });
      }
      if (await git(["status", "--porcelain"]))
        throw new Error(
          "Dependency installation or checks changed tracked files. Commit the required fixes before building.",
        );
      commit = await git(["rev-parse", "HEAD"]);
      const pkg = JSON.parse(
        NodeFS.readFileSync(NodePath.join(config.workDir, "apps/desktop/package.json"), "utf8"),
      );
      version = `${pkg.version}-${config.branch}.${commit.slice(0, 9)}`;
      report({ stage: "building", commit, version, message: "Building the AppImage…" });
      const releaseDir = NodePath.join(config.workDir, "release");
      const oldArtifacts = await NodeFSP.readdir(releaseDir).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const file of oldArtifacts.filter((file) => file.endsWith(".AppImage"))) {
        await NodeFSP.unlink(NodePath.join(releaseDir, file));
      }
      await run(
        tools.vp,
        [
          "run",
          "dist:desktop:artifact",
          "--platform",
          "linux",
          "--target",
          "AppImage",
          "--arch",
          "x64",
          "--build-version",
          version,
        ],
        { cwd: config.workDir },
      );
      const artifacts = (await NodeFSP.readdir(NodePath.join(config.workDir, "release"))).filter(
        (file) => file.endsWith(".AppImage"),
      );
      if (artifacts.length !== 1) throw new Error("Expected one built AppImage.");
      artifact = NodePath.join(config.workDir, "release", artifacts[0]);
      if ((await git(["status", "--porcelain"])) || (await git(["rev-parse", "HEAD"])) !== commit)
        throw new Error("The checkout changed during the build.");
      break;
    } catch (error) {
      await repair(error);
    }
  }
  // A developer can keep working during the build, but a new local commit needs reconciliation.
  if ((await git(["rev-parse", `refs/heads/${config.branch}`], config.repo)) !== localHead)
    throw new Error(
      "The local fork changed during the update. Synchronize it before retrying. Nothing was pushed.",
    );
  const sha256 = await digest(artifact);
  report({ stage: "publishing", message: "Publishing the verified commit…" });
  await git([
    "push",
    `--force-with-lease=refs/heads/${config.branch}:${original}`,
    config.origin,
    `HEAD:refs/heads/${config.branch}`,
  ]);
  NodeFS.writeFileSync(
    NodePath.join(config.stateDir, "published.json"),
    JSON.stringify({ commit, sourceCommit: localHead }),
    { mode: 0o600 },
  );
  report({ stage: "installing", message: "Installing the prepared AppImage…" });
  await installArtifact(artifact, config.target);
  const installed = await NodeFSP.stat(config.target);
  report({
    installedSize: installed.size,
    installedMtimeMs: installed.mtimeMs,
    stage: "ready",
    commit,
    version,
    sha256,
    message: "Update installed. Restart when you are ready.",
  });
}

export async function installArtifact(artifact, target) {
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  const pending = `${target}.pending`;
  await NodeFSP.copyFile(artifact, pending);
  await NodeFSP.chmod(pending, 0o755);
  if (NodeFS.existsSync(target)) await NodeFSP.copyFile(target, `${target}.previous`);
  NodeFS.renameSync(pending, target);
}
async function findTool(name, candidates = []) {
  for (const file of [
    ...candidates,
    ...(process.env.PATH || "").split(":").map((dir) => NodePath.join(dir, name)),
  ]) {
    try {
      await NodeFSP.access(file, 1);
      return await NodeFSP.realpath(file);
    } catch {
      /* try next */
    }
  }
  throw new Error(`${name} is not installed.`);
}
async function main() {
  const config = defaults();
  NodeFS.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const action = process.argv[2] || "status";
  if (action === "status") {
    console.log(JSON.stringify(await status(config)));
    return;
  }
  if (action === "start") {
    if (await active()) {
      console.log(JSON.stringify(await status(config)));
      return;
    }
    const previous = await status(config);
    if (previous.stage === "ready" && previous.version !== process.argv[3])
      throw new Error("An update is already prepared. Restart before preparing another one.");
    const node = await findTool("node", [
      NodePath.join(NodeOS.homedir(), ".local/share/fnm/aliases/default/bin/node"),
    ]);
    // Snapshot the runner so a rebase or edit cannot change a job already in progress.
    const runner = NodePath.join(config.stateDir, "runner.mjs");
    await NodeFSP.copyFile(NodeURL.fileURLToPath(import.meta.url), runner);
    await exec("systemd-run", [
      "--user",
      "--collect",
      "--quiet",
      "--unit=t3fork-update",
      "--property=RuntimeMaxSec=2h",
      "--property=TimeoutStopSec=10s",
      "--setenv=ELECTRON_RUN_AS_NODE=",
      `--setenv=PATH=${process.env.PATH || "/usr/bin:/bin"}`,
      `--setenv=T3CODE_REPO=${config.repo}`,
      "--",
      "/usr/bin/flock",
      "--nonblock",
      "--no-fork",
      NodePath.join(config.stateDir, "lock"),
      node,
      runner,
      "run",
      process.argv[3] || "",
    ]);
    console.log(JSON.stringify(await status(config)));
    return;
  }
  if (action === "cancel") {
    const state = await status(config);
    if (["publishing", "installing"].includes(state.stage))
      throw new Error("Publication is finishing. Wait for the result before cancelling.");
    if (!terminal.has(state.stage))
      await exec("systemctl", ["--user", "kill", "--kill-whom=main", "--signal=SIGUSR1", unit]);
    console.log(JSON.stringify(await status(config)));
    return;
  }
  if (action === "restart") {
    const state = await status(config);
    if (state.stage !== "ready" || !state.sha256 || (await digest(config.target)) !== state.sha256)
      throw new Error(
        "The installed AppImage no longer matches the prepared update. Prepare it again.",
      );
    const appPid = process.argv[4];
    if (!appPid || !/^[1-9][0-9]*$/.test(appPid))
      throw new Error("Restart must be requested by the desktop app.");
    await exec("systemd-run", [
      "--user",
      "--collect",
      "--quiet",
      `--unit=t3fork-restart-${NodeCrypto.randomUUID()}`,
      "--",
      "/usr/bin/bash",
      "-c",
      'for ((i=0; i<120; i++)); do if ! kill -0 "$1" 2>/dev/null; then exec /usr/bin/env -u ELECTRON_RUN_AS_NODE "$2"; fi; sleep 0.5; done; exit 1',
      "t3fork-relaunch",
      appPid,
      config.target,
    ]);
    console.log(JSON.stringify(state));
    return;
  }
  if (action !== "run") throw new Error(`Unknown action: ${action}`);
  const runId = NodeCrypto.randomUUID();
  const workDir = NodePath.join(config.stateDir, "work", runId);
  NodeFS.mkdirSync(NodePath.dirname(workDir), { recursive: true });
  let state = { ...empty(), stage: "starting", runId, workDir };
  let cancelled = false;
  const report = (patch) => {
    if (cancelled && patch.stage !== "cancelled") throw new Error("Update cancelled.");
    state = { ...state, ...patch };
    saveState(config, state);
  };
  process.on("SIGUSR1", () => {
    if (terminal.has(state.stage) || ["publishing", "installing"].includes(state.stage)) return;
    cancelled = true;
    report({ stage: "cancelled", message: "Update cancelled. You can retry." });
    void exec("systemctl", ["--user", "stop", "--no-block", unit]);
  });
  report({ message: "Starting update…" });
  try {
    const vp = await findTool("vp", [
      NodePath.join(NodeOS.homedir(), ".local/share/vite-plus/bin/vp"),
      NodePath.join(NodeOS.homedir(), ".vite-plus/bin/vp"),
    ]);
    const codex = await findTool("codex", [NodePath.join(NodeOS.homedir(), ".local/bin/codex")]);
    let published;
    try {
      published = JSON.parse(
        NodeFS.readFileSync(NodePath.join(config.stateDir, "published.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await prepareUpdate(
      {
        ...config,
        published,
        workDir,
        runningCommit: process.argv[3]?.match(/-moinax\.([a-f0-9]+)$/)?.[1],
      },
      commandRunner(NodePath.join(config.stateDir, `${runId}.log`)),
      report,
      { vp, codex },
    );
  } catch (error) {
    if (!cancelled) report({ stage: "error", message: error.message.slice(-6000) });
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
