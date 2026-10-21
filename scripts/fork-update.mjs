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
export function updaterPath(path = process.env.PATH || "/usr/bin:/bin") {
  // AppImage mounts disappear when the desktop exits. A stale FUSE entry makes
  // execvp fail with ENOTCONN before it reaches the system tools later in PATH.
  return path
    .split(NodePath.delimiter)
    .filter((entry) => !entry.split(NodePath.sep).some((part) => part.startsWith(".mount_")))
    .join(NodePath.delimiter);
}
// Upstream creates tag and release together after all builds pass, and withdraws
// a broken nightly by deleting the release (the tag stays). So a release with an
// uploaded AppImage marks a candidate, and `target_commitish` must be the commit
// CI built: a branch name cannot say which.
export function selectNightly(releases) {
  const built = (Array.isArray(releases) ? releases : []).filter(
    (release) =>
      release?.draft === false &&
      release?.prerelease === true &&
      /-nightly\./.test(release?.tag_name ?? "") &&
      /^[0-9a-f]{40}$/.test(release?.target_commitish ?? "") &&
      (release?.assets ?? []).some(
        (asset) => asset?.state === "uploaded" && (asset?.name ?? "").endsWith(".AppImage"),
      ),
  );
  built.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const latest = built[0];
  return latest
    ? { commit: latest.target_commitish, tag: latest.tag_name, publishedAt: latest.published_at }
    : null;
}
export async function resolveNightly(url) {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "t3fork-update" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`GitHub could not list upstream's nightly releases (HTTP ${response.status}).`);
  const nightly = selectNightly(await response.json());
  // Never fall back to main: the whole point of following the nightly is that
  // main carries commits no build has exercised yet.
  if (!nightly) throw new Error("Upstream has published no built nightly release to follow.");
  return nightly;
}
export const defaults = () => ({
  repo: process.env.T3CODE_REPO || NodePath.join(NodeOS.homedir(), "Projects/labs/t3code"),
  stateDir: NodePath.join(NodeOS.homedir(), ".local/state/t3fork"),
  target: NodePath.join(NodeOS.homedir(), ".local/share/AppImages/t3-code.AppImage"),
  origin: "https://github.com/Moinax/t3code.git",
  upstream: "https://github.com/pingdotgg/t3code.git",
  releases: "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=30",
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
  targetTag: null,
  changes: [],
  changeCount: 0,
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
  if (state.stage === "ready") savePreparedUpdate(config, state);
}
function savePreparedUpdate(config, state) {
  const file = NodePath.join(config.stateDir, "prepared.json");
  const temp = `${file}.${NodeCrypto.randomUUID()}`;
  NodeFS.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  NodeFS.renameSync(temp, file);
}
// Each run's work directory costs gigabytes and is dead once its update is
// installed. Keep the one still prepared (compareLocalBuild() diffs its .git)
// and the run starting now; drop every other.
export async function pruneWorkDirs(config, keep) {
  const root = NodePath.join(config.stateDir, "work");
  const stale = (await NodeFSP.readdir(root).catch(() => [])).filter(
    (entry) => !keep.includes(entry),
  );
  // One at a time: these are multi-gigabyte trees, and unlinking them in
  // parallel only puts the disk in contention with the clone that follows.
  for (const entry of stale)
    await NodeFSP.rm(NodePath.join(root, entry), { recursive: true, force: true });
  return stale;
}
export async function readPreparedUpdate(config) {
  // Older installed runners only write status.json, including after a later upstream update.
  let prepared = readState(config);
  if (prepared.stage !== "ready") {
    try {
      prepared = JSON.parse(
        await NodeFSP.readFile(NodePath.join(config.stateDir, "prepared.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return null;
    }
  }
  if (prepared.stage !== "ready") return null;
  const installed = await NodeFSP.stat(config.target).catch(() => null);
  return installed &&
    installed.size === prepared.installedSize &&
    installed.mtimeMs === prepared.installedMtimeMs
    ? prepared
    : null;
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
export async function readUpdateLog(file) {
  // Read one extra byte so a truncated first line (or ANSI sequence) can be discarded.
  const { stdout } = await exec("tail", ["-c", "16001", file]).catch(() => ({ stdout: "" }));
  if (Buffer.byteLength(stdout) <= 16000) return stdout;
  const newline = stdout.indexOf("\n");
  return newline === -1 ? "" : stdout.slice(newline + 1);
}
export async function compareLocalBuild(config, prepared) {
  if (!prepared) return "changed";
  if (!prepared.workDir || !prepared.commit) return "unknown";
  const options = {
    cwd: config.repo,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10000,
  };
  const candidate = [
    "--git-dir",
    NodePath.join(prepared.workDir, ".git"),
    "--work-tree",
    config.repo,
    "-c",
    "core.fsmonitor=false",
  ];
  const cacheKey = NodeCrypto.createHash("sha256")
    .update(JSON.stringify([config.repo, prepared.workDir, prepared.commit]))
    .digest("hex");
  const cachedIndex = NodePath.join(config.stateDir, `compare-${cacheKey}.index`);
  const index = `${cachedIndex}.${NodeCrypto.randomUUID()}`;
  const candidateOptions = { ...options, env: { ...options.env, GIT_INDEX_FILE: index } };
  try {
    // The build's index knows about uncommitted files already included in that build.
    // git diff refreshes index timestamps, so use a private copy and retain that cache
    // between polls to avoid rehashing every unchanged file on each status request.
    await NodeFSP.copyFile(cachedIndex, index).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return NodeFSP.copyFile(NodePath.join(prepared.workDir, ".git/index"), index);
    });
    await exec(
      "git",
      [...candidate, "diff", "--quiet", "--no-ext-diff", prepared.commit, "--"],
      candidateOptions,
    );
    const [built, local] = await Promise.all([
      exec(
        "git",
        [...candidate, "ls-tree", "-r", "--name-only", "-z", prepared.commit],
        candidateOptions,
      ),
      exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], options),
    ]);
    const builtPaths = new Set(built.stdout.split("\0"));
    for (const file of local.stdout.split("\0")) {
      if (!file || builtPaths.has(file)) continue;
      // An unstaged deletion can still be in the source index but absent from the build.
      const exists = await NodeFSP.lstat(NodePath.join(config.repo, file)).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (exists) return "changed";
    }
    return "up-to-date";
  } catch (error) {
    // git diff exits 1 for changed content; unavailable snapshots must not claim a match.
    return error.code === 1 ? "changed" : "unknown";
  } finally {
    await NodeFSP.rename(index, cachedIndex).catch(() => NodeFSP.rm(index, { force: true }));
  }
}
export async function localClean(config) {
  try {
    const { stdout } = await exec(
      "git",
      ["-C", config.repo, "status", "--porcelain", "--untracked-files=all"],
      {
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        maxBuffer: 4 * 1024 * 1024,
        timeout: 10000,
      },
    );
    return stdout.trim() === "";
  } catch {
    return false;
  }
}
/**
 * Commits on the fork branch this machine has not published, which the app's upstream count
 * cannot see and the manual update exists for. A local view: other machines' pushes show on fetch.
 */
export async function unpublishedCommits(config) {
  if (!config.branch) return 0;
  try {
    const { stdout } = await exec(
      "git",
      ["-C", config.repo, "rev-list", "--count", `refs/remotes/origin/${config.branch}..HEAD`],
      { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 10000 },
    );
    return Number(stdout.trim()) || 0;
  } catch {
    // No such ref, not a checkout, HEAD elsewhere: nothing to claim either way.
    return 0;
  }
}

/**
 * Whether the running app was built from the checkout's HEAD: the one no-op condition the app
 * cannot answer itself, which a rebuild button needs to know whether it would do anything.
 */
export async function runningIsHead(config) {
  if (!config.runningCommit) return false;
  try {
    const { stdout } = await exec("git", ["-C", config.repo, "rev-parse", "HEAD"], {
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      timeout: 10000,
    });
    return stdout.trim().startsWith(config.runningCommit);
  } catch {
    return false;
  }
}

export async function status(config) {
  const saved = readState(config);
  const state = reconcileState(saved, await active());
  if (state.stage !== saved.stage && state.stage === "error") saveState(config, state);
  let log = "";
  if (state.runId && /^[a-f0-9-]+$/.test(state.runId)) {
    log = await readUpdateLog(NodePath.join(config.stateDir, `${state.runId}.log`));
  }
  const prepared = await readPreparedUpdate(config);
  const rollback = await readRollback(config);
  if (state.stage === "ready" && !prepared) {
    const invalid = {
      ...state,
      stage: "error",
      message: "The installed AppImage changed or is missing. Prepare the update again.",
    };
    saveState(config, invalid);
    // Including the rollback: this is what a hand install looks like to the
    // updater, and going back a build is the one action that recovers from it.
    return { ...invalid, log, ...(rollback ? { rollbackVersion: rollback.version ?? null } : {}) };
  }
  return {
    ...state,
    log,
    localBuildStatus: terminal.has(state.stage)
      ? await compareLocalBuild(config, prepared)
      : "unknown",
    // What the update brings in outlives the run that prepared it: the window
    // shows the installed build's changes until the next one resolves its own.
    localClean: await localClean(config),
    unpublishedCommits: await unpublishedCommits(config),
    runningIsHead: await runningIsHead(config),
    targetTag: state.targetTag ?? prepared?.targetTag ?? null,
    changes: state.changes?.length ? state.changes : (prepared?.changes ?? []),
    changeCount: state.changeCount || (prepared?.changeCount ?? 0),
    ...(prepared
      ? { preparedVersion: prepared.version, preparedSource: prepared.source ?? "upstream" }
      : {}),
    ...(rollback ? { rollbackVersion: rollback.version ?? null } : {}),
  };
}

export function commandRunner(logFile) {
  return (command, args, options = {}) =>
    new Promise((resolveCommand, reject) => {
      NodeFS.appendFileSync(
        logFile,
        `\n$ ${command} ${options.agent ? "[repair instructions]" : args.join(" ")}\n`,
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
            const message =
              event.type === "assistant"
                ? (event.message?.content ?? [])
                    .map((part) =>
                      part?.type === "text"
                        ? part.text
                        : part?.type === "tool_use"
                          ? `${part.name}: ${part.input?.command ?? part.input?.file_path ?? ""}`
                          : null,
                    )
                    .filter(Boolean)
                    .join("\n")
                : event.type === "result"
                  ? event.result
                  : event.type === "system" && event.subtype === "init"
                    ? `model: ${event.model}`
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

async function checkAndBuild(config, run, report, tools, base) {
  const git = (args) => run("git", args, { cwd: config.workDir });
  report({
    stage: "checking",
    message: "Installing dependencies and checking the desktop, web and server…",
  });
  await run(tools.vp, ["install", "--frozen-lockfile"], { cwd: config.workDir });
  const changed = (await git(["diff", "--name-only", base, "HEAD"])).split("\n");
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
  const commit = await git(["rev-parse", "HEAD"]);
  const pkg = JSON.parse(
    NodeFS.readFileSync(NodePath.join(config.workDir, "apps/desktop/package.json"), "utf8"),
  );
  const version = `${pkg.version}-${config.branch}.${config.source === "local" ? "local." : ""}${commit.slice(0, 9)}`;
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
  const artifact = NodePath.join(config.workDir, "release", artifacts[0]);
  if ((await git(["status", "--porcelain"])) || (await git(["rev-parse", "HEAD"])) !== commit)
    throw new Error("The checkout changed during the build.");
  return { artifact, commit, version };
}

export async function prepareUpdate(config, run, report, tools) {
  const git = (args, cwd = config.workDir) => run("git", args, { cwd });
  const assertLocalReady = async (expectedHead) => {
    if (
      (await git(["symbolic-ref", "--short", "HEAD"], config.repo)) !== config.branch ||
      (await git(["status", "--porcelain", "--untracked-files=all"], config.repo)) ||
      (expectedHead && (await git(["rev-parse", "HEAD"], config.repo)) !== expectedHead)
    )
      throw new Error(
        "The local fork changed or has uncommitted files. Commit your work and select the fork branch before updating. Nothing will be overwritten.",
      );
  };
  await assertLocalReady();
  const localHead = await git(["rev-parse", "HEAD"], config.repo);
  const synchronize = async (commit) => {
    report({ stage: "publishing", message: "Synchronizing the local checkout and dependencies…" });
    await assertLocalReady(localHead);
    await git(["fetch", "--no-tags", config.workDir, commit], config.repo);
    await assertLocalReady(localHead);
    await git(
      ["update-ref", `refs/backups/fork-update/${NodeCrypto.randomUUID()}`, localHead],
      config.repo,
    );
    // --keep refuses conflicting working-file changes; never discard edits with --hard.
    await git(["reset", "--keep", commit], config.repo);
    await git(["update-ref", `refs/remotes/origin/${config.branch}`, commit], config.repo);
    await run(tools.vp, ["install", "--frozen-lockfile"], { cwd: config.repo });
    await assertLocalReady(commit);
  };
  report({
    source: "upstream",
    stage: "fetching",
    message: "Fetching the published fork and upstream…",
  });
  // Include unpublished commits when they extend the published fork.
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
  await git(["fetch", "--no-tags", config.repo, localHead]);
  const ancestor = async (base, head) => {
    const bases = await git(["merge-base", "--all", base, head]);
    return bases.split("\n").includes(base);
  };
  if (
    localHead !== original &&
    !(await ancestor(original, localHead)) &&
    !(await ancestor(localHead, original)) &&
    !(config.published?.commit === original && config.published?.sourceCommit === localHead)
  )
    throw new Error(
      "The local and published fork have diverged. Reconcile their commits before updating.",
    );
  if (localHead !== original && (await ancestor(original, localHead)))
    await git(["reset", "--keep", localHead]);
  const base = await git(["rev-parse", "HEAD"]);
  await git(["config", "user.name", await git(["config", "user.name"], config.repo)]);
  await git(["config", "user.email", await git(["config", "user.email"], config.repo)]);
  // The runner owns publication. An agent's ordinary git push cannot publish this checkout.
  await git(["remote", "set-url", "--push", "origin", "DISABLED"]);
  await git(["remote", "add", "upstream", config.upstream]);
  // The nightly release, not upstream/main: main's tip is whatever landed
  // minutes ago, and rebasing onto a commit whose build upstream has not run
  // is how a broken build reaches this machine before upstream notices it.
  const target = await (tools.resolveNightly ?? resolveNightly)(config.releases);
  await git(["fetch", "--no-tags", "upstream", target.commit]);
  const upstream = await git(["rev-parse", target.commit]);
  const missing = await git(["rev-list", "--count", `${original}..${upstream}`]);
  // Count from the running build, not the checkout: updates chain without a
  // restart, and measuring from HEAD would drop the earlier unread batch. Falls back
  // to HEAD when the running commit is not in this clone.
  let since = original;
  if (config.runningCommit) {
    // The running commit leaves the branch after a rebase and `clone` copies only
    // refs/heads, so fetch that single ref rather than the refs/backups namespace,
    // which grows with every update. Best effort: failing falls back to HEAD.
    const ref = await (async () => {
      // Both in the checkout, where the ref still lives: `git` here takes the
      // working directory as its second argument, defaulting to the clone.
      const full = await git(
        ["rev-parse", "--verify", `${config.runningCommit}^{commit}`],
        config.repo,
      );
      return git(
        ["for-each-ref", "--points-at", full, "--count=1", "--format=%(refname)"],
        config.repo,
      );
    })().catch(() => "");
    if (ref) {
      await git(["fetch", "--no-tags", config.repo, `+${ref}:${ref}`]).catch(() => {});
      since = await git(["rev-parse", "--verify", `${config.runningCommit}^{commit}`]).catch(
        () => original,
      );
    }
  }
  // Capped because a quiet week upstream is still several hundred commits, and
  // this is carried in the state the app reads over IPC. Read before the rebase
  // rewrites the range.
  const changes = (
    await git(["log", "--no-merges", "--format=%h %s", "--max-count=300", `${since}..${upstream}`])
  )
    .split("\n")
    .filter(Boolean);
  // Counted the same way the list is built, merges excluded: `missing` includes
  // them, and a heading that says "300 of 312" against a list that can only hold
  // non-merge subjects is two totals wearing one name.
  const changeCount = await git(["rev-list", "--count", "--no-merges", `${since}..${upstream}`]);
  report({ targetTag: target.tag ?? null, changes, changeCount: Number(changeCount) });
  if (
    missing === "0" &&
    base === original &&
    config.runningCommit &&
    original.startsWith(config.runningCommit)
  ) {
    await synchronize(original);
    report({
      stage: "idle",
      message: `The fork, local checkout and running app are up to date with ${target.tag ?? "upstream"}.`,
    });
    return;
  }
  let attempt = 0;
  const rebasing = async () => {
    for (const dir of ["rebase-merge", "rebase-apply"]) {
      const path = await git(["rev-parse", "--path-format=absolute", "--git-path", dir]);
      if (NodeFS.existsSync(path)) return true;
    }
    return false;
  };
  const repair = async (error) => {
    if (++attempt > 2)
      throw new Error(
        `Automatic repair did not pass verification after two attempts. ${error.message}`,
      );
    report({
      stage: "repairing",
      attempt,
      message: `Opus 5.5 is fixing the update, attempt ${attempt}/2…`,
    });
    await run(
      tools.claude,
      [
        "--print",
        // Pinned rather than the `opus` alias: the alias moves with releases,
        // and a repair is replayed against a checkout, not against whatever
        // model happens to be newest that week.
        "--model",
        "claude-opus-5-5",
        "--effort",
        "high",
        // stream-json refuses to run without --verbose, and together they are
        // what makes the activity log readable while the repair is happening
        // rather than one blob after it ends.
        "--output-format",
        "stream-json",
        "--verbose",
        // Nobody is watching this run, so a permission prompt is not a question
        // but a hang, until RuntimeMaxSec kills it two hours later.
        "--permission-mode",
        "bypassPermissions",
        // No `--bare`: it also skips ~/.claude/.credentials.json and the run fails "Not
        // logged in". Without a sandbox, the instructions, the clone, the DISABLED push
        // URL and the runner verifying everything before publishing bound the repair.
        `Maintain this T3 Code fork after rebasing onto upstream ${upstream}. Resolve all rebase conflicts and finish the rebase, then fix integration errors. Preserve the intent of every custom fork patch. Read AGENTS.md. Do not delete tests or weaken checks to make them pass. Do not push, install, restart, modify other checkouts, or spawn other agents. Do not run repo-wide tests/typechecks or launch browsers. The runner performs scoped checks and builds after you finish. Every fix belongs to the fork patch it repairs, never to a commit of its own: resolve a conflict inside the commit being replayed (git add, then git rebase --continue), and for anything you find after the rebase has finished, identify the fork commit that introduced the code you are fixing (git log ${upstream}..HEAD, git log -S) and commit with 'git commit --fixup=<that commit>' — the runner squashes those in. Only an entirely new patch upstream made necessary may be an ordinary conventional commit, and say so if you add one. If a change needs a human decision, explain it and leave the checkout unready. Failure details:\n${error.message.slice(-6000)}`,
      ],
      { cwd: config.workDir, agent: true },
    );
    // An agent's `fixup!` repairs one of our patches. Folding it in here keeps one
    // commit per patch, so the next rebase replays fewer commits and `git log` says
    // what the fork changes rather than how its last update went.
    if (await rebasing()) return;
    const subjects = await git(["log", "--format=%s", `${upstream}..HEAD`]);
    if (!/^(?:fixup|squash)! /m.test(subjects)) return;
    if (await git(["status", "--porcelain"]))
      throw new Error("The repair left uncommitted changes beside its fixup commits.");
    // Both editors: --autosquash is non-interactive here, and an editor
    // launched by either hook would block a run nobody is watching.
    try {
      await git([
        "-c",
        "sequence.editor=true",
        "-c",
        "core.editor=true",
        "rebase",
        "--autosquash",
        upstream,
      ]);
    } catch (error) {
      // A `fixup!` that applied on the tip can conflict when replayed onto its early
      // patch. That is one more conflict, not a failed run: leave the rebase unfinished
      // for the next repair attempt. Anything failing outside a rebase is this run's error.
      if (!(await rebasing())) throw error;
      return;
    }
    report({
      message: `Folded the repair into the patches it fixes (attempt ${attempt}/2).`,
    });
  };
  report({
    stage: "rebasing",
    message: `Rebasing ${missing} upstream commits onto ${target.tag ?? "upstream"}…`,
  });
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
      if (await rebasing()) throw new Error("The rebase is still in progress.");
      await git(["merge-base", "--is-ancestor", upstream, "HEAD"]);
      if (await git(["status", "--porcelain"]))
        throw new Error("The repair left uncommitted changes.");
      ({ artifact, commit, version } = await checkAndBuild(config, run, report, tools, original));
      break;
    } catch (error) {
      await repair(error);
    }
  }
  // A developer can keep working during the build, but a new local commit needs reconciliation.
  await assertLocalReady(localHead);
  const sha256 = await digest(artifact);
  report({ stage: "publishing", message: "Publishing the verified commit…" });
  await git([
    "push",
    `--force-with-lease=refs/heads/${config.branch}:${original}`,
    config.origin,
    `HEAD:refs/heads/${config.branch}`,
  ]);
  // The fork's main mirrors upstream, so `check:changed` against origin/main sees the fork's
  // own changes instead of every upstream commit since it was last moved. Fast-forward only,
  // and a main someone moved elsewhere stays put: a stale mirror never fails an update.
  await git(["push", config.origin, `${upstream}:refs/heads/main`]).catch(() => {});
  NodeFS.writeFileSync(
    NodePath.join(config.stateDir, "published.json"),
    JSON.stringify({ commit, sourceCommit: localHead }),
    { mode: 0o600 },
  );
  try {
    await synchronize(commit);
  } catch (error) {
    throw new Error(
      `The verified update was published, but local synchronization failed. The installed app is unchanged. ${error.message}`,
      { cause: error },
    );
  }
  report({ stage: "installing", message: "Installing the prepared AppImage…" });
  await installArtifact(artifact, config.target, config.backup);
  const installed = await NodeFSP.stat(config.target);
  report({
    installedSize: installed.size,
    installedMtimeMs: installed.mtimeMs,
    stage: "ready",
    commit,
    version,
    sha256,
    message:
      "Fork published, local checkout synchronized and app installed. Restart when you are ready.",
  });
}

export async function prepareLocalUpdate(config, run, report, tools) {
  const git = (args, options = {}) =>
    run("git", args, {
      cwd: config.repo,
      ...options,
      env: { GIT_OPTIONAL_LOCKS: "0", ...options.env },
    });
  report({ source: "local", stage: "snapshotting", message: "Snapshotting local changes…" });
  if (await git(["diff", "--name-only", "--diff-filter=U"]))
    throw new Error("Resolve the local merge conflicts before building.");
  const original = await git(["rev-parse", "HEAD"]);
  const base = await git(["merge-base", original, `refs/remotes/origin/${config.branch}`]).catch(
    () => original,
  );
  const index = NodePath.join(config.stateDir, `${NodeCrypto.randomUUID()}.index`);
  let snapshot;
  try {
    // An alternate index includes the working files without changing staged changes or branch refs.
    const sourceIndex = await git(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    await NodeFSP.copyFile(sourceIndex, index);
    const env = { GIT_INDEX_FILE: index };
    await git(["-c", "core.splitIndex=false", "add", "--all", "--", "."], { env });
    const tree = await git(["write-tree"], { env });
    snapshot = await git([
      "-c",
      "user.name=T3 Code",
      "-c",
      "user.email=local-build@t3.codes",
      "-c",
      "commit.gpgsign=false",
      "commit-tree",
      tree,
      "-p",
      original,
      "-m",
      "Local desktop build snapshot",
    ]);
  } finally {
    await NodeFSP.rm(index, { force: true });
  }
  if ((await git(["rev-parse", "HEAD"])) !== original)
    throw new Error("The local checkout changed while taking the snapshot. Retry the build.");
  // What this build has that the running one does not — the same question the
  // upstream path answers with the commits it took in, asked of our own. Off
  // HEAD rather than the snapshot, whose one commit is the uncommitted work
  // itself and names nothing.
  const changes = await localChangesSince(config, config.runningCommit, original);
  report({ changes, changeCount: changes.length });
  await run("git", ["clone", "--no-local", "--no-checkout", config.repo, config.workDir]);
  const candidate = (args) => git(args, { cwd: config.workDir });
  await candidate(["fetch", "--no-tags", config.repo, snapshot]);
  await candidate(["checkout", "--detach", snapshot]);
  await candidate(["remote", "set-url", "--push", "origin", "DISABLED"]);
  const { artifact, commit, version } = await checkAndBuild(
    { ...config, source: "local" },
    run,
    report,
    tools,
    base,
  );
  const sha256 = await digest(artifact);
  report({ stage: "installing", message: "Installing the local build…" });
  await installArtifact(artifact, config.target, config.backup);
  const installed = await NodeFSP.stat(config.target);
  report({
    installedSize: installed.size,
    installedMtimeMs: installed.mtimeMs,
    stage: "ready",
    commit,
    version,
    sha256,
    message: "Local build installed. Restart when you are ready.",
  });
}

export async function installArtifact(artifact, target, backup) {
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  const pending = `${target}.pending`;
  await NodeFSP.copyFile(artifact, pending);
  await NodeFSP.chmod(pending, 0o755);
  // The rollback copy is the last build that actually ran. Updates now chain
  // without a restart in between, so every run after the first must leave it
  // alone: what it would save is its own predecessor, a build nothing has ever
  // started, which is the one thing a rollback must never land on.
  if (backup && NodeFS.existsSync(target)) {
    // Through a temporary name, like the target below: a copy interrupted
    // half-way would otherwise leave a truncated AppImage as the only way back,
    // discovered at the moment it is needed.
    const previous = `${target}.previous`;
    await NodeFSP.copyFile(target, `${previous}.pending`);
    NodeFS.renameSync(`${previous}.pending`, previous);
    NodeFS.writeFileSync(`${previous}.json`, JSON.stringify(backup), { mode: 0o600 });
  }
  NodeFS.renameSync(pending, target);
}

/**
 * Put the previous build back.
 *
 * The same swap `t3fork rollback` performs in shell, which is the copy that has
 * to work when the app no longer starts at all — there is no window to click
 * and nothing built from the checkout to trust. Keep the two in step.
 */
export function rollbackInstalled(config) {
  const backup = `${config.target}.previous`;
  if (!NodeFS.existsSync(backup)) throw new Error("There is no previous build to roll back to.");
  NodeFS.renameSync(backup, config.target);
  NodeFS.rmSync(`${backup}.json`, { force: true });
  // Whatever was prepared is gone with the file it described, and the next
  // nightly should be taken from scratch rather than compared against it.
  NodeFS.rmSync(NodePath.join(config.stateDir, "prepared.json"), { force: true });
  saveState(config, {
    ...empty(),
    message: "Rolled back to the previous build. Restart to run it.",
  });
}

/** The build a rollback would restore, or null when there is none to restore. */
export async function readRollback(config) {
  if (!NodeFS.existsSync(`${config.target}.previous`)) return null;
  try {
    return JSON.parse(await NodeFSP.readFile(`${config.target}.previous.json`, "utf8"));
  } catch {
    // The sidecar is only a label; the restorable thing is the AppImage beside
    // it. Absent, unreadable or half-written, the answer is the same — and it
    // has to be, because `status` reads this on every poll: throwing here would
    // take down the panel that offers the rollback, over the name of the build.
    return { version: null };
  }
}
/**
 * Quit is the app's own, so this waits for the pid to go rather than kill it:
 * the relaunch has to happen after the window closes, from a unit that outlives
 * the process asking for it.
 */
function assertAppPid(appPid) {
  if (!appPid || !/^[1-9][0-9]*$/.test(appPid))
    throw new Error("Restarting must be requested by the desktop app.");
}
async function relaunch(config, appPid) {
  assertAppPid(appPid);
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
/** The commit a fork build's version string names, e.g. `0.1.0-moinax.f968b5b356`. */
export const forkBuildCommit = (version) => version?.match(/-moinax\.([a-f0-9]+)$/)?.[1];

/**
 * The commits one local build has that another did not, newest first. Capped, and empty when it
 * cannot answer (a rebase may leave the older commit unreachable); never worth failing an install.
 */
export async function localChangesSince(config, since, commit) {
  if (!since) return [];
  const log = await exec(
    "git",
    [
      "-C",
      config.repo,
      "log",
      "--no-merges",
      "--format=%h %s",
      "--max-count=300",
      `${since}..${commit}`,
    ],
    {
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10000,
    },
  ).catch(() => null);
  return log ? log.stdout.split("\n").filter(Boolean) : [];
}

async function main() {
  process.env.PATH = updaterPath();
  const config = { ...defaults(), runningCommit: forkBuildCommit(process.argv[3]) };
  NodeFS.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const action = process.argv[2] || "status";
  if (action === "status") {
    console.log(JSON.stringify(await status(config)));
    return;
  }
  if (action === "start" || action === "start-local") {
    if (await active()) {
      console.log(JSON.stringify(await status(config)));
      return;
    }
    const previous = await status(config);
    if (action === "start-local" && previous.localBuildStatus === "up-to-date") {
      console.log(JSON.stringify(previous));
      return;
    }
    // Upstream updates chain over one another — the build they replace was
    // never run. A local build is not that: it was asked for by hand, and the
    // renderer refuses to replace it automatically. Say so here too, since the
    // runner is also reachable from a terminal.
    if (
      action === "start" &&
      previous.preparedSource === "local" &&
      previous.preparedVersion &&
      previous.preparedVersion !== process.argv[3]
    )
      throw new Error("A local build is prepared. Restart before preparing an update over it.");
    const node = await findTool("node", [
      NodePath.join(NodeOS.homedir(), ".local/share/fnm/aliases/default/bin/node"),
    ]);
    // Snapshot the runner so a rebase or edit cannot change a job already in progress.
    const runner = NodePath.join(config.stateDir, `runner-${NodeCrypto.randomUUID()}.mjs`);
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
      action === "start-local" ? "run-local" : "run",
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
    const prepared = await readPreparedUpdate(config);
    if (!terminal.has(state.stage))
      throw new Error("Wait for the current build before restarting.");
    if (!prepared?.sha256 || (await digest(config.target)) !== prepared.sha256)
      throw new Error(
        "The installed AppImage no longer matches the prepared update. Prepare it again.",
      );
    await relaunch(config, process.argv[4]);
    console.log(JSON.stringify(state));
    return;
  }
  if (action === "rollback") {
    const state = await status(config);
    if (!terminal.has(state.stage))
      throw new Error("Wait for the current build before rolling back.");
    // Before the swap, not after: `relaunch` refusing a pid-less call once the
    // files had moved would report a failure for a rollback that had happened,
    // and leave the window running a build no longer on disk.
    assertAppPid(process.argv[4]);
    rollbackInstalled(config);
    await relaunch(config, process.argv[4]);
    console.log(JSON.stringify(await status(config)));
    return;
  }
  // A `t3fork install` build is a prepared local build like any other. The record
  // is written here, not in the shell, so the restart button has one writer to read
  // instead of a hand install clearing the records and losing the restart offer.
  if (action === "record-installed") {
    const version = process.argv[3];
    const commit = process.argv[4];
    if (!version || !commit) throw new Error("record-installed needs a version and a commit.");
    // A running job owns these records and finishes by writing its own.
    if (await active()) throw new Error("An update is running; it records its own build.");
    const installed = await NodeFSP.stat(config.target);
    // The build this one replaces, read before the record describing it is
    // overwritten: what someone restarting wants listed is what is new since
    // the build they are running, not every commit the branch carries.
    const replaced = await NodeFSP.readFile(NodePath.join(config.stateDir, "prepared.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    const since = forkBuildCommit(replaced?.version);
    const changes = await localChangesSince(config, since, commit);
    saveState(config, {
      ...empty(),
      source: "local",
      stage: "ready",
      commit,
      version,
      sha256: await digest(config.target),
      installedSize: installed.size,
      installedMtimeMs: installed.mtimeMs,
      // The checkout is this build's own tree, so `compareLocalBuild` can say
      // whether editing has since moved past it — as it does for an in-app
      // local build, which clones that tree instead of using it in place.
      workDir: config.repo,
      changes,
      changeCount: changes.length,
      message: "Local build installed by hand. Restart when you are ready.",
    });
    console.log(JSON.stringify(await status(config)));
    return;
  }
  if (action !== "run" && action !== "run-local") throw new Error(`Unknown action: ${action}`);
  const previous = await readPreparedUpdate(config);
  if (previous) savePreparedUpdate(config, previous);
  // An update already prepared means the file on disk was never started: the
  // app is still running the older build, so that older build stays the one a
  // rollback restores and this run saves nothing.
  const running = process.argv[3] || "";
  // `version: null` rather than the empty string a hand-run leaves behind: the
  // app renders an absent name as "the previous build", and `""` is not absent.
  const backup = previous && previous.version !== running ? null : { version: running || null };
  const runId = NodeCrypto.randomUUID();
  const workDir = NodePath.join(config.stateDir, "work", runId);
  NodeFS.mkdirSync(NodePath.dirname(workDir), { recursive: true });
  // Before this run clones, not after it succeeds: a failed run's tree then
  // stays inspectable until the next run starts, and the disk is reclaimed
  // either way. $runId cannot collide, but name it rather than rely on that.
  await pruneWorkDirs(config, [previous?.runId, runId]);
  let state = {
    ...empty(),
    source: action === "run-local" ? "local" : "upstream",
    stage: "starting",
    runId,
    workDir,
  };
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
    const run = commandRunner(NodePath.join(config.stateDir, `${runId}.log`));
    if (action === "run-local") {
      await prepareLocalUpdate({ ...config, backup, workDir }, run, report, { vp });
      return;
    }
    const claude = await findTool("claude", [NodePath.join(NodeOS.homedir(), ".local/bin/claude")]);
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
        backup,
        published,
        workDir,
        runningCommit: config.runningCommit,
      },
      run,
      report,
      { vp, claude },
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
