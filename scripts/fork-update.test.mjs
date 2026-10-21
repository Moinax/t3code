import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import {
  updaterPath,
  commandRunner,
  prepareUpdate,
  prepareLocalUpdate,
  readPreparedUpdate,
  compareLocalBuild,
  localChangesSince,
  installArtifact,
  reconcileState,
  saveState,
  readState,
  readUpdateLog,
  pruneWorkDirs,
  selectNightly,
  readRollback,
  rollbackInstalled,
  status,
} from "./fork-update.mjs";
const exec = NodeUtil.promisify(NodeChildProcess.execFile);

NodeTest.test(
  "updater commands use persistent tools instead of the desktop AppImage",
  async (t) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-path-"));
    t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
    const mount = NodePath.join(root, ".mount_t3-code-old", "usr", "bin");
    const persistent = NodePath.join(root, "bin");
    for (const [directory, value] of [
      [mount, "appimage"],
      [persistent, "system"],
    ]) {
      await NodeFSP.mkdir(directory, { recursive: true });
      await NodeFSP.writeFile(NodePath.join(directory, "probe"), `#!/bin/sh\necho ${value}\n`, {
        mode: 0o755,
      });
    }
    const path = updaterPath([mount, persistent, "/usr/bin", "/bin"].join(NodePath.delimiter));
    NodeAssert.equal(
      (await exec("probe", [], { env: { ...process.env, PATH: path } })).stdout.trim(),
      "system",
    );
    await NodeFSP.rm(NodePath.dirname(NodePath.dirname(mount)), { recursive: true });
    NodeAssert.equal(
      (await exec("probe", [], { env: { ...process.env, PATH: path } })).stdout.trim(),
      "system",
    );
    NodeAssert.equal(updaterPath("/custom/bin:/usr/bin:/bin"), "/custom/bin:/usr/bin:/bin");
  },
);

NodeTest.test(
  "activity tail preserves ANSI colors and discards a truncated first line",
  async (t) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-log-"));
    t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
    const file = NodePath.join(root, "update.log");
    const colored = "\u001b[32mMigration complete\u001b[39m\n";
    await NodeFSP.writeFile(file, colored);
    NodeAssert.equal(await readUpdateLog(file), colored);
    await NodeFSP.writeFile(file, `${"x".repeat(17000)}\n${colored}`);
    NodeAssert.equal(await readUpdateLog(file), colored);
    await NodeFSP.writeFile(file, "x".repeat(17000));
    NodeAssert.equal(await readUpdateLog(file), "");
    NodeAssert.equal(await readUpdateLog(NodePath.join(root, "missing.log")), "");
  },
);
const git = async (cwd, ...args) =>
  (await exec("git", args, { cwd, env: { ...process.env, GIT_EDITOR: "true" } })).stdout.trim();

async function fixture(t, conflict = false) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-test-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const repo = NodePath.join(root, "source");
  const origin = NodePath.join(root, "origin.git");
  const upstream = NodePath.join(root, "upstream.git");
  await NodeFSP.mkdir(repo);
  await git(root, "init", "--bare", origin);
  await git(root, "init", "--bare", upstream);
  await git(repo, "init", "-b", "main");
  await git(repo, "config", "user.name", "Test");
  await git(repo, "config", "user.email", "test@example.com");
  for (const name of ["desktop", "web", "server"])
    await NodeFSP.mkdir(NodePath.join(repo, "apps", name), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(repo, "apps/desktop/package.json"), '{"version":"1.0.0"}');
  await NodeFSP.writeFile(NodePath.join(repo, ".gitignore"), "release/\n");
  await NodeFSP.writeFile(NodePath.join(repo, "feature"), "base\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "initial");
  await git(repo, "remote", "add", "origin", origin);
  await git(repo, "remote", "add", "upstream", upstream);
  await git(repo, "push", "upstream", "main");
  await git(repo, "switch", "-c", "moinax");
  await NodeFSP.writeFile(NodePath.join(repo, conflict ? "feature" : "custom"), "fork\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "custom fork behavior");
  await git(repo, "push", "origin", "moinax");
  const original = await git(repo, "rev-parse", "HEAD");
  await git(repo, "switch", "main");
  await NodeFSP.writeFile(NodePath.join(repo, "feature"), "upstream\n");
  await git(repo, "commit", "-am", "upstream behavior");
  await git(repo, "push", "upstream", "main");
  const upstreamHead = await git(repo, "rev-parse", "HEAD");
  await git(repo, "switch", "moinax");
  const config = {
    repo,
    origin,
    upstream,
    branch: "moinax",
    stateDir: NodePath.join(root, "state"),
    workDir: NodePath.join(root, "candidate"),
    target: NodePath.join(root, "installed.AppImage"),
    // What main() passes when the installed build is the one running.
    backup: { version: "0.1.0-moinax.old" },
  };
  await NodeFSP.mkdir(config.stateDir);
  await NodeFSP.writeFile(config.target, "old app");
  const stages = [];
  let state;
  const report = (patch) => {
    stages.push(patch.stage);
    state = { ...state, ...patch };
  };
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push([command, ...args]);
    if (command === "git")
      return commandRunner(NodePath.join(root, "commands.log"))(command, args, {
        ...options,
        cwd: options.cwd || root,
      });
    if (command === "vp") {
      if (args[1] === "dist:desktop:artifact") {
        // The run's own directory, not the fixture's: a second preparation
        // builds in a fresh clone, and an artifact left in the first one reads
        // to it as a build that produced nothing.
        const dir = options.cwd || config.workDir;
        await NodeFSP.mkdir(NodePath.join(dir, "release"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(dir, "release/app.AppImage"), "new app");
      }
      return "";
    }
    throw new Error("Unexpected agent invocation");
  };
  return {
    config,
    original,
    upstreamHead,
    stages,
    state: () => state,
    report,
    calls,
    run,
    tools: {
      vp: "vp",
      claude: "claude",
      resolveNightly: async () => ({
        commit: upstreamHead,
        tag: "v0.1.1-nightly.20261020.3401",
        publishedAt: "2026-10-20T08:56:40Z",
      }),
    },
  };
}

NodeTest.test(
  "rebases, verifies, builds, publishes with a lease and installs the exact candidate",
  async (t) => {
    const f = await fixture(t);
    await prepareUpdate(f.config, f.run, f.report, f.tools);
    NodeAssert.equal(f.state().stage, "ready");
    NodeAssert.ok(f.stages.indexOf("checking") < f.stages.indexOf("building"));
    NodeAssert.ok(f.stages.indexOf("building") < f.stages.indexOf("publishing"));
    NodeAssert.ok(f.stages.indexOf("publishing") < f.stages.indexOf("installing"));
    NodeAssert.equal(await git(f.config.origin, "rev-parse", "moinax"), f.state().commit);
    await git(f.config.workDir, "merge-base", "--is-ancestor", f.upstreamHead, "HEAD");
    NodeAssert.equal(await git(f.config.repo, "rev-parse", "HEAD"), f.state().commit);
    NodeAssert.equal(await git(f.config.repo, "rev-parse", "origin/moinax"), f.state().commit);
    NodeAssert.equal(await git(f.config.repo, "status", "--porcelain"), "");
    NodeAssert.equal(
      await compareLocalBuild(f.config, { ...f.state(), workDir: f.config.workDir }),
      "up-to-date",
    );
    NodeAssert.equal(await NodeFSP.readFile(f.config.target, "utf8"), "new app");
    NodeAssert.equal(await NodeFSP.readFile(`${f.config.target}.previous`, "utf8"), "old app");
    NodeAssert.equal(f.state().sha256.length, 64);
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, "custom"), "utf8"),
      "fork\n",
    );
    NodeAssert.ok(
      f.calls.some((call) => call.includes(`--force-with-lease=refs/heads/moinax:${f.original}`)),
    );
  },
);

NodeTest.test(
  "local builds snapshot unpublished, staged, unstaged and new files without changing the source",
  async (t) => {
    const f = await fixture(t);
    const file = (name) => NodePath.join(f.config.repo, name);
    await NodeFSP.writeFile(file("local-commit"), "unpublished\n");
    await git(f.config.repo, "add", "local-commit");
    await git(f.config.repo, "commit", "-m", "local work");
    const head = await git(f.config.repo, "rev-parse", "HEAD");
    await NodeFSP.writeFile(file("custom"), "staged\n");
    await git(f.config.repo, "add", "custom");
    await NodeFSP.writeFile(file("custom"), "working version\n");
    await NodeFSP.writeFile(file("new-file"), "new\n");
    await NodeFSP.unlink(file("feature"));
    await NodeFSP.mkdir(file("release"));
    await NodeFSP.writeFile(file("release/ignored"), "ignored\n");
    await NodeFSP.writeFile(file("release/forced"), "explicitly tracked\n");
    await git(f.config.repo, "add", "--force", "release/forced");
    await NodeFSP.symlink("custom", file("local-link"));
    await NodeFSP.writeFile(file("local-script"), "#!/bin/sh\n", { mode: 0o755 });
    const before = await git(f.config.repo, "status", "--porcelain");
    const index = await NodeFSP.readFile(file(".git/index"));
    await prepareLocalUpdate(f.config, f.run, f.report, { vp: "vp" });
    NodeAssert.equal(f.state().source, "local");
    NodeAssert.equal(f.state().stage, "ready");
    NodeAssert.match(f.state().version, /^1\.0\.0-moinax\.local\.[a-f0-9]{9}$/);
    NodeAssert.deepEqual(await NodeFSP.readFile(file(".git/index")), index);
    NodeAssert.equal(await git(f.config.repo, "status", "--porcelain"), before);
    NodeAssert.equal(await git(f.config.repo, "rev-parse", "HEAD"), head);
    NodeAssert.equal(await git(f.config.repo, "show", ":custom"), "staged");
    NodeAssert.equal(await NodeFSP.readFile(file("custom"), "utf8"), "working version\n");
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, "custom"), "utf8"),
      "working version\n",
    );
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, "local-commit"), "utf8"),
      "unpublished\n",
    );
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, "new-file"), "utf8"),
      "new\n",
    );
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, "release/forced"), "utf8"),
      "explicitly tracked\n",
    );
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(f.config.workDir, "feature")), false);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(f.config.workDir, "release/ignored")), false);
    NodeAssert.equal(
      await NodeFSP.readlink(NodePath.join(f.config.workDir, "local-link")),
      "custom",
    );
    NodeAssert.ok(
      (await NodeFSP.stat(NodePath.join(f.config.workDir, "local-script"))).mode & 0o100,
    );
    NodeAssert.equal(await git(f.config.origin, "rev-parse", "moinax"), f.original);
    NodeAssert.equal(
      f.calls.some(([command, action]) => command === "git" && ["push", "rebase"].includes(action)),
      false,
    );
    NodeAssert.equal(
      f.calls.some((call) => call.includes(f.config.upstream)),
      false,
    );
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(f.config.stateDir, "published.json")), false);
    NodeAssert.equal(await NodeFSP.readFile(f.config.target, "utf8"), "new app");
    NodeAssert.equal(
      await compareLocalBuild(f.config, { ...f.state(), workDir: f.config.workDir }),
      "up-to-date",
    );
  },
);

NodeTest.test(
  "a failed local check keeps the installed update ready through failure and cancellation",
  async (t) => {
    const f = await fixture(t);
    const installed = await NodeFSP.stat(f.config.target);
    const prepared = {
      stage: "ready",
      source: "upstream",
      version: "1.0.0-moinax.abc123",
      installedSize: installed.size,
      installedMtimeMs: installed.mtimeMs,
    };
    saveState(f.config, prepared);
    const report = (patch) => {
      f.report(patch);
      saveState(f.config, f.state());
    };
    const run = (command, args, options) => {
      if (command === "vp" && args[1] === "typecheck") throw new Error("local check failed");
      return f.run(command, args, options);
    };
    await NodeAssert.rejects(
      prepareLocalUpdate(f.config, run, report, { vp: "vp" }),
      /local check failed/,
    );
    for (const stage of ["error", "cancelled"]) {
      report({ stage });
      NodeAssert.equal((await readPreparedUpdate(f.config)).version, prepared.version);
    }
    NodeAssert.equal(await NodeFSP.readFile(f.config.target, "utf8"), "old app");
    NodeAssert.equal(f.stages.includes("installing"), false);
    await NodeFSP.writeFile(f.config.target, "externally replaced app");
    NodeAssert.equal(await readPreparedUpdate(f.config), null);
  },
);

NodeTest.test(
  "local build uses its snapshot even if the source is edited while building",
  async (t) => {
    const f = await fixture(t);
    const report = (patch) => {
      f.report(patch);
      saveState(f.config, f.state());
    };
    const run = async (command, args, options) => {
      if (command === "vp" && args[0] === "install")
        await NodeFSP.writeFile(NodePath.join(f.config.repo, "custom"), "later edit\n");
      return f.run(command, args, options);
    };
    await prepareLocalUpdate(f.config, run, report, { vp: "vp" });
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, "custom"), "utf8"),
      "fork\n",
    );
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.repo, "custom"), "utf8"),
      "later edit\n",
    );
    NodeAssert.equal((await readPreparedUpdate(f.config)).version, f.state().version);
    NodeAssert.equal((await readPreparedUpdate(f.config)).source, "local");
  },
);

NodeTest.test(
  "local build comparison detects content changes and ignores commits and generated files",
  async (t) => {
    const f = await fixture(t);
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "new-file"), "snapshot\n");
    await prepareLocalUpdate(f.config, f.run, f.report, { vp: "vp" });
    const prepared = { ...f.state(), workDir: f.config.workDir };
    const compare = () => compareLocalBuild(f.config, prepared);
    const sourceIndex = await NodeFSP.readFile(NodePath.join(f.config.repo, ".git/index"));
    const buildIndex = await NodeFSP.readFile(NodePath.join(f.config.workDir, ".git/index"));
    NodeAssert.equal(await compare(), "up-to-date");
    NodeAssert.deepEqual(
      await NodeFSP.readFile(NodePath.join(f.config.repo, ".git/index")),
      sourceIndex,
    );
    NodeAssert.deepEqual(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, ".git/index")),
      buildIndex,
    );
    await NodeFSP.mkdir(NodePath.join(f.config.repo, "release"));
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "release/generated"), "output");
    await NodeFSP.appendFile(NodePath.join(f.config.repo, ".git/info/exclude"), "\nprivate-note\n");
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "private-note"), "ignored");
    NodeAssert.equal(await compare(), "up-to-date");
    await git(f.config.repo, "add", "new-file");
    await git(f.config.repo, "commit", "-m", "commit already built content");
    NodeAssert.equal(await compare(), "up-to-date");
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "new-file"), "modified\n");
    NodeAssert.equal(await compare(), "changed");
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "new-file"), "snapshot\n");
    NodeAssert.equal(await compare(), "up-to-date");
    await NodeFSP.chmod(NodePath.join(f.config.repo, "new-file"), 0o755);
    NodeAssert.equal(await compare(), "changed");
    await NodeFSP.chmod(NodePath.join(f.config.repo, "new-file"), 0o644);
    await NodeFSP.unlink(NodePath.join(f.config.repo, "new-file"));
    NodeAssert.equal(await compare(), "changed");
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "new-file"), "snapshot\n");
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "later-file"), "new");
    NodeAssert.equal(await compare(), "changed");
    await git(f.config.repo, "add", "later-file");
    NodeAssert.equal(await compare(), "changed");
    await NodeFSP.unlink(NodePath.join(f.config.repo, "later-file"));
    NodeAssert.equal(await compare(), "up-to-date");
    await NodeFSP.rm(f.config.workDir, { recursive: true });
    NodeAssert.equal(await compare(), "unknown");
    NodeAssert.equal(await compareLocalBuild(f.config, null), "changed");
  },
);

NodeTest.test("recognizes a prepared update written by an older installed runner", async (t) => {
  const f = await fixture(t);
  const installed = await NodeFSP.stat(f.config.target);
  const old = {
    stage: "ready",
    version: "1.0.0-moinax.old",
    installedSize: 1,
    installedMtimeMs: 0,
  };
  saveState(f.config, old);
  const latest = {
    stage: "ready",
    version: "1.0.0-moinax.new",
    installedSize: installed.size,
    installedMtimeMs: installed.mtimeMs,
  };
  await NodeFSP.writeFile(NodePath.join(f.config.stateDir, "status.json"), JSON.stringify(latest));
  NodeAssert.equal((await readPreparedUpdate(f.config)).version, latest.version);
});

NodeTest.test(
  "a conflict invokes the configured agent, then verifies its completed rebase",
  async (t) => {
    const f = await fixture(t, true);
    const run = async (command, args, options) => {
      if (command !== "claude") return f.run(command, args, options);
      NodeAssert.ok(args.includes("claude-opus-5-5"));
      NodeAssert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2), [
        "--effort",
        "high",
      ]);
      // A prompt nobody can answer is a two-hour hang, not a question.
      NodeAssert.ok(args.includes("bypassPermissions"));
      // --bare would skip the credentials with it, and the repair would come
      // back "Not logged in" having fixed nothing.
      NodeAssert.ok(!args.includes("--bare"));
      await NodeFSP.writeFile(NodePath.join(f.config.workDir, "feature"), "upstream and fork\n");
      await git(f.config.workDir, "add", "feature");
      await git(f.config.workDir, "rebase", "--continue");
      return "";
    };
    await prepareUpdate(f.config, run, f.report, f.tools);
    NodeAssert.equal(f.state().stage, "ready");
    NodeAssert.equal(f.state().attempt, 1);
    NodeAssert.equal(
      await NodeFSP.readFile(NodePath.join(f.config.workDir, "feature"), "utf8"),
      "upstream and fork\n",
    );
  },
);

NodeTest.test(
  "a failed check invokes repair and reruns verification before publishing",
  async (t) => {
    const f = await fixture(t);
    let fail = true;
    let repairs = 0;
    const run = async (command, args, options) => {
      if (command === "vp" && args[1] === "typecheck" && fail) {
        fail = false;
        throw new Error("integration failure");
      }
      if (command === "claude") {
        repairs++;
        return "";
      }
      return f.run(command, args, options);
    };
    await prepareUpdate(f.config, run, f.report, f.tools);
    NodeAssert.equal(repairs, 1);
    NodeAssert.equal(f.state().stage, "ready");
  },
);

NodeTest.test(
  "two failed repairs leave the published fork and installed app untouched",
  async (t) => {
    const f = await fixture(t);
    let repairs = 0;
    const run = async (command, args, options) => {
      if (command === "vp" && args[1] === "typecheck") throw new Error("broken types");
      if (command === "claude") {
        repairs++;
        return "";
      }
      return f.run(command, args, options);
    };
    await NodeAssert.rejects(prepareUpdate(f.config, run, f.report, f.tools), /two attempts/);
    NodeAssert.equal(repairs, 2);
    NodeAssert.equal(await git(f.config.origin, "rev-parse", "moinax"), f.original);
    NodeAssert.equal(await NodeFSP.readFile(f.config.target, "utf8"), "old app");
  },
);

NodeTest.test("a concurrent remote push rejects publication and does not install", async (t) => {
  const f = await fixture(t);
  let otherHead;
  const run = async (command, args, options) => {
    if (command === "git" && args[0] === "push") {
      await NodeFSP.writeFile(NodePath.join(f.config.repo, "other-machine"), "new work");
      await git(f.config.repo, "add", ".");
      await git(f.config.repo, "commit", "-m", "another machine");
      await git(f.config.repo, "push", "origin", "moinax");
      otherHead = await git(f.config.repo, "rev-parse", "HEAD");
    }
    return f.run(command, args, options);
  };
  await NodeAssert.rejects(prepareUpdate(f.config, run, f.report, f.tools), /stale info/);
  NodeAssert.equal(await git(f.config.origin, "rev-parse", "moinax"), otherHead);
  NodeAssert.equal(await NodeFSP.readFile(f.config.target, "utf8"), "old app");
});

NodeTest.test("local commits made during the build stop publication", async (t) => {
  const f = await fixture(t);
  const run = async (command, args, options) => {
    if (command === "vp" && args[1] === "dist:desktop:artifact") {
      await git(f.config.repo, "commit", "--allow-empty", "-m", "new local work");
    }
    return f.run(command, args, options);
  };
  await NodeAssert.rejects(prepareUpdate(f.config, run, f.report, f.tools), /local fork changed/);
  NodeAssert.equal(await git(f.config.origin, "rev-parse", "moinax"), f.original);
});

NodeTest.test("upstream updates include and publish unpublished local commits", async (t) => {
  const f = await fixture(t);
  await NodeFSP.writeFile(NodePath.join(f.config.repo, "local-feature"), "keep this patch\n");
  await git(f.config.repo, "add", ".");
  await git(f.config.repo, "commit", "-m", "local feature");
  await prepareUpdate(f.config, f.run, f.report, f.tools);
  NodeAssert.equal(await git(f.config.repo, "show", "HEAD:local-feature"), "keep this patch");
  NodeAssert.equal(await git(f.config.origin, "show", "moinax:local-feature"), "keep this patch");
  NodeAssert.equal(await git(f.config.repo, "show", "HEAD:feature"), "upstream");
  NodeAssert.equal(
    await compareLocalBuild(f.config, { ...f.state(), workDir: f.config.workDir }),
    "up-to-date",
  );
});

NodeTest.test(
  "local commits are built even when upstream and the running app were current",
  async (t) => {
    const f = await fixture(t);
    await git(f.config.repo, "merge", "main", "--no-edit");
    await git(f.config.repo, "push", "origin", "moinax");
    const runningCommit = await git(f.config.repo, "rev-parse", "HEAD");
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "custom"), "new committed work\n");
    await git(f.config.repo, "commit", "-am", "local change");
    await prepareUpdate({ ...f.config, runningCommit }, f.run, f.report, f.tools);
    NodeAssert.equal(f.state().stage, "ready");
    NodeAssert.equal(await git(f.config.origin, "show", "moinax:custom"), "new committed work");
  },
);

NodeTest.test("divergent local commits are preserved without publishing", async (t) => {
  const f = await fixture(t);
  await git(f.config.repo, "commit", "--allow-empty", "-m", "published change");
  await git(f.config.repo, "push", "origin", "moinax");
  const published = await git(f.config.repo, "rev-parse", "HEAD");
  await git(f.config.repo, "reset", "--keep", f.original);
  await git(f.config.repo, "commit", "--allow-empty", "-m", "divergent change");
  const local = await git(f.config.repo, "rev-parse", "HEAD");
  await NodeAssert.rejects(prepareUpdate(f.config, f.run, f.report, f.tools), /have diverged/);
  NodeAssert.equal(await git(f.config.repo, "rev-parse", "HEAD"), local);
  NodeAssert.equal(await git(f.config.origin, "rev-parse", "moinax"), published);
});

for (const timing of ["before", "build", "publication"]) {
  NodeTest.test(`edits ${timing} are preserved and prevent a completed update`, async (t) => {
    const f = await fixture(t);
    const file = NodePath.join(f.config.repo, "custom");
    if (timing === "before") await NodeFSP.writeFile(file, "unfinished work\n");
    const run = async (command, args, options) => {
      if (
        (timing === "build" && command === "vp" && args[1] === "dist:desktop:artifact") ||
        (timing === "publication" && command === "git" && args[0] === "push")
      )
        await NodeFSP.writeFile(file, "unfinished work\n");
      return f.run(command, args, options);
    };
    await NodeAssert.rejects(prepareUpdate(f.config, run, f.report, f.tools), /uncommitted files/);
    NodeAssert.equal(await NodeFSP.readFile(file, "utf8"), "unfinished work\n");
    NodeAssert.equal(await git(f.config.repo, "rev-parse", "HEAD"), f.original);
    NodeAssert.equal(await NodeFSP.readFile(f.config.target, "utf8"), "old app");
    if (timing !== "publication")
      NodeAssert.equal(await git(f.config.origin, "rev-parse", "moinax"), f.original);
  });
}

NodeTest.test(
  "an older updater's checkout is synchronized even when the app is already current",
  async (t) => {
    const f = await fixture(t);
    await prepareUpdate(f.config, f.run, f.report, f.tools);
    const published = JSON.parse(
      await NodeFSP.readFile(NodePath.join(f.config.stateDir, "published.json"), "utf8"),
    );
    await git(f.config.repo, "reset", "--keep", f.original);
    await prepareUpdate(
      {
        ...f.config,
        published,
        workDir: `${f.config.workDir}-next`,
        runningCommit: published.commit,
      },
      f.run,
      f.report,
      f.tools,
    );
    NodeAssert.equal(await git(f.config.repo, "rev-parse", "HEAD"), published.commit);
    NodeAssert.equal(f.state().stage, "idle");
  },
);

NodeTest.test(
  "the next run accepts the unchanged source checkout after its own previous publication",
  async (t) => {
    const f = await fixture(t);
    await prepareUpdate(f.config, f.run, f.report, f.tools);
    const published = JSON.parse(
      await NodeFSP.readFile(NodePath.join(f.config.stateDir, "published.json"), "utf8"),
    );
    const config = {
      ...f.config,
      published,
      workDir: `${f.config.workDir}-next`,
      runningCommit: published.commit.slice(0, 9),
    };
    await prepareUpdate(config, f.run, f.report, f.tools);
    NodeAssert.equal(f.state().stage, "idle");
  },
);

NodeTest.test(
  "an interrupted process is reported as failed, and a stopped ready state stays ready",
  () => {
    NodeAssert.equal(reconcileState({ stage: "building" }, false).stage, "error");
    NodeAssert.equal(reconcileState({ stage: "ready" }, false).stage, "ready");
    NodeAssert.equal(reconcileState({ stage: "ready" }, true).stage, "starting");
  },
);

NodeTest.test(
  "state is persisted and a failed artifact copy preserves the installed app",
  async (t) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-state-"));
    t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
    const config = { stateDir: root };
    saveState(config, { stage: "building", message: "Building" });
    NodeAssert.equal(readState(config).stage, "building");
    const target = NodePath.join(root, "app");
    await NodeFSP.writeFile(target, "working");
    await NodeAssert.rejects(installArtifact(NodePath.join(root, "missing"), target));
    NodeAssert.equal(await NodeFSP.readFile(target, "utf8"), "working");
    NodeAssert.equal(NodeFS.existsSync(`${target}.previous`), false);
  },
);

NodeTest.test("the rollback copy stays on the build that ran across chained updates", async (t) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-rollback-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const target = NodePath.join(root, "app");
  const config = { target };
  await NodeFSP.writeFile(target, "running");
  for (const [name, body] of [
    ["first", "first build"],
    ["second", "second build"],
  ])
    await NodeFSP.writeFile(NodePath.join(root, name), body);

  NodeAssert.equal(await readRollback(config), null);

  // The app is running what is installed, so that is what a rollback restores.
  await installArtifact(NodePath.join(root, "first"), target, { version: "0.1.0-moinax.aaaaaaa" });
  NodeAssert.equal(await NodeFSP.readFile(`${target}.previous`, "utf8"), "running");
  NodeAssert.equal((await readRollback(config)).version, "0.1.0-moinax.aaaaaaa");

  // Prepared again before the restart: keeping "first" would offer a rollback
  // onto a build nothing ever started.
  await installArtifact(NodePath.join(root, "second"), target, null);
  NodeAssert.equal(await NodeFSP.readFile(target, "utf8"), "second build");
  NodeAssert.equal(await NodeFSP.readFile(`${target}.previous`, "utf8"), "running");
  NodeAssert.equal((await readRollback(config)).version, "0.1.0-moinax.aaaaaaa");

  // A copy left by a runner from before the name was recorded is still restorable.
  await NodeFSP.rm(`${target}.previous.json`);
  NodeAssert.deepEqual(await readRollback(config), { version: null });
});

NodeTest.test(
  "command failures and agent events remain inspectable in the bounded activity log",
  async (t) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-log-"));
    t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
    const log = NodePath.join(root, "activity.log");
    const run = commandRunner(log);
    await NodeAssert.rejects(
      run(process.execPath, ["-e", "console.error('build failed'); process.exit(2)"]),
      /build failed/,
    );
    await run(
      process.execPath,
      [
        "-e",
        "console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Resolved the conflict'},{type:'tool_use',name:'Bash',input:{command:'git rebase --continue'}}]}}))",
      ],
      { agent: true },
    );
    const text = await NodeFSP.readFile(log, "utf8");
    NodeAssert.match(text, /build failed/);
    NodeAssert.match(text, /Resolved the conflict/);
    NodeAssert.match(text, /Bash: git rebase --continue/);
  },
);

NodeTest.test("pruning work directories keeps the prepared run and the one starting", async (t) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-prune-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const config = { stateDir: root };
  const work = NodePath.join(root, "work");
  for (const run of ["prepared", "current", "stale-one", "stale-two"])
    await NodeFSP.mkdir(NodePath.join(work, run, "node_modules"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(work, "stale-one", "node_modules", "big"), "x");

  const removed = await pruneWorkDirs(config, ["prepared", "current"]);

  NodeAssert.deepEqual(removed.sort(), ["stale-one", "stale-two"]);
  NodeAssert.deepEqual((await NodeFSP.readdir(work)).sort(), ["current", "prepared"]);
  // No prepared update means no run to spare, and a missing work/ is not an error.
  NodeAssert.deepEqual(await pruneWorkDirs(config, [undefined, "current"]), ["prepared"]);
  await NodeFSP.rm(work, { recursive: true, force: true });
  NodeAssert.deepEqual(await pruneWorkDirs(config, ["current"]), []);
});

NodeTest.test("only a nightly release with an uploaded build is a rebase target", () => {
  const asset = [{ name: "T3-Code-x86_64.AppImage", state: "uploaded" }];
  const sha = (char) => char.repeat(40);
  NodeAssert.deepEqual(
    selectNightly([
      // The tag upstream pushes before CI finishes: no release at all, so it
      // cannot reach this list -- but a release whose upload is still running
      // can, and it is the same unfinished build.
      {
        tag_name: "v0.1.1-nightly.20261020.3399",
        target_commitish: sha("b"),
        published_at: "2026-10-20T09:00:00Z",
        draft: false,
        prerelease: true,
        assets: [{ name: "T3-Code-x86_64.AppImage", state: "uploading" }],
      },
      // A maintainer's own test build, explicitly not for installing.
      {
        tag_name: "v0.1.1-preview.20261019.3339",
        target_commitish: sha("c"),
        published_at: "2026-10-21T00:00:00Z",
        draft: false,
        prerelease: true,
        assets: asset,
      },
      {
        tag_name: "v0.1.1-nightly.20261019.3373",
        target_commitish: sha("d"),
        published_at: "2026-10-19T18:00:00Z",
        draft: false,
        prerelease: true,
        assets: asset,
      },
      // Newest of the built nightlies, and therefore the answer.
      {
        tag_name: "v0.1.1-nightly.20261020.3401",
        target_commitish: sha("e"),
        published_at: "2026-10-20T08:56:40Z",
        draft: false,
        prerelease: true,
        assets: asset,
      },
      // A release pointing at a branch cannot say which commit CI built.
      {
        tag_name: "v0.1.1-nightly.20261020.3402",
        target_commitish: "main",
        published_at: "2026-10-20T12:00:00Z",
        draft: false,
        prerelease: true,
        assets: asset,
      },
      {
        tag_name: "v0.1.1-nightly.20261020.3403",
        target_commitish: sha("f"),
        published_at: "2026-10-20T13:00:00Z",
        draft: true,
        prerelease: true,
        assets: asset,
      },
      {
        tag_name: "v0.2.0",
        target_commitish: sha("a"),
        published_at: "2026-10-20T14:00:00Z",
        draft: false,
        prerelease: false,
        assets: asset,
      },
    ]),
    { commit: sha("e"), tag: "v0.1.1-nightly.20261020.3401", publishedAt: "2026-10-20T08:56:40Z" },
  );
  NodeAssert.equal(selectNightly([]), null);
  NodeAssert.equal(selectNightly(undefined), null);
});

NodeTest.test("a repair's fixup commit is folded into the fork patch it repairs", async (t) => {
  const f = await fixture(t);
  let fail = true;
  const run = async (command, args, options) => {
    if (command === "vp" && args[1] === "typecheck" && fail) {
      fail = false;
      throw new Error("integration failure");
    }
    if (command === "claude") {
      // What the agent is told to do: fix the patch, not commit beside it.
      const patch = await git(f.config.workDir, "rev-parse", "HEAD");
      await NodeFSP.writeFile(NodePath.join(f.config.workDir, "custom"), "fork, repaired\n");
      await git(f.config.workDir, "add", "custom");
      await git(f.config.workDir, "commit", `--fixup=${patch}`);
      return "";
    }
    return f.run(command, args, options);
  };
  await prepareUpdate(f.config, run, f.report, f.tools);
  NodeAssert.equal(f.state().stage, "ready");
  const subjects = await git(f.config.workDir, "log", "--format=%s", `${f.upstreamHead}..HEAD`);
  NodeAssert.deepEqual(subjects.split("\n"), ["custom fork behavior"]);
  NodeAssert.equal(
    await NodeFSP.readFile(NodePath.join(f.config.workDir, "custom"), "utf8"),
    "fork, repaired\n",
  );
});

NodeTest.test("a rollback puts the previous build back and forgets what it replaced", async (t) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-swap-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const config = { stateDir: NodePath.join(root, "state"), target: NodePath.join(root, "app") };
  await NodeFSP.mkdir(config.stateDir);

  await NodeAssert.rejects(async () => rollbackInstalled(config), /no previous build/);

  await NodeFSP.writeFile(config.target, "broken");
  await NodeFSP.writeFile(`${config.target}.previous`, "working");
  await NodeFSP.writeFile(`${config.target}.previous.json`, JSON.stringify({ version: "old" }));
  saveState(config, { stage: "ready", message: "Ready", version: "new" });

  rollbackInstalled(config);
  NodeAssert.equal(await NodeFSP.readFile(config.target, "utf8"), "working");
  NodeAssert.equal(NodeFS.existsSync(`${config.target}.previous`), false);
  // Both described the file that was just replaced. Left behind, prepared.json
  // reports a build that is no longer installed as an update waiting to be run.
  NodeAssert.equal(NodeFS.existsSync(`${config.target}.previous.json`), false);
  NodeAssert.equal(NodeFS.existsSync(NodePath.join(config.stateDir, "prepared.json")), false);
  NodeAssert.equal(readState(config).stage, "idle");
  NodeAssert.equal(await readPreparedUpdate(config), null);
  NodeAssert.equal(await readRollback(config), null);
});

NodeTest.test("a half-written rollback label never takes the updater down with it", async (t) => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3fork-label-"));
  t.after(() => NodeFSP.rm(root, { recursive: true, force: true }));
  const config = { stateDir: NodePath.join(root, "state"), target: NodePath.join(root, "app") };
  await NodeFSP.mkdir(config.stateDir);
  await NodeFSP.writeFile(`${config.target}.previous`, "working");
  await NodeFSP.writeFile(`${config.target}.previous.json`, '{"version":"0.1.0-moi');
  // status() reads this on every poll: throwing would take down the panel that
  // offers the rollback, over the name of the build rather than the build.
  NodeAssert.deepEqual(await readRollback(config), { version: null });
  NodeAssert.equal((await status(config)).rollbackVersion, null);
});

NodeTest.test(
  "a second update stacked on an unrestarted first still reports both batches",
  async (t) => {
    const f = await fixture(t);
    // The build that is running is the fork as it stands now; nothing restarts
    // between the two runs, so this stays true for both.
    const runningCommit = f.original;
    await prepareUpdate({ ...f.config, runningCommit }, f.run, f.report, f.tools);
    NodeAssert.deepEqual(
      f.state().changes.map((line) => line.split(" ").slice(1).join(" ")),
      ["upstream behavior"],
    );

    await git(f.config.repo, "switch", "main");
    await NodeFSP.writeFile(NodePath.join(f.config.repo, "feature"), "upstream again\n");
    await git(f.config.repo, "commit", "-am", "second upstream behavior");
    await git(f.config.repo, "push", "upstream", "main");
    const second = await git(f.config.repo, "rev-parse", "HEAD");
    await git(f.config.repo, "switch", "moinax");

    await prepareUpdate(
      { ...f.config, runningCommit, workDir: `${f.config.workDir}-next` },
      f.run,
      f.report,
      {
        ...f.tools,
        resolveNightly: async () => ({ commit: second, tag: "v0.1.1-nightly.20261020.3411" }),
      },
    );
    // Measured from the checkout this would be the second commit alone, and the
    // first would vanish from a list nobody had read yet.
    NodeAssert.deepEqual(
      f.state().changes.map((line) => line.split(" ").slice(1).join(" ")),
      ["second upstream behavior", "upstream behavior"],
    );
    NodeAssert.equal(f.state().changeCount, 2);
  },
);

NodeTest.test("a local build lists the commits the running build did not have", async (t) => {
  const f = await fixture(t);
  const since = await git(f.config.repo, "rev-parse", "HEAD");
  await NodeFSP.writeFile(NodePath.join(f.config.repo, "custom"), "fork again\n");
  await git(f.config.repo, "commit", "-am", "local fork behavior");
  const head = await git(f.config.repo, "rev-parse", "HEAD");

  NodeAssert.deepEqual(
    (await localChangesSince(f.config, since, head)).map((line) =>
      line.split(" ").slice(1).join(" "),
    ),
    ["local fork behavior"],
  );
  // No earlier build to measure from, and a commit a rebase has since collected:
  // both leave the build installable and only the list unanswered.
  NodeAssert.deepEqual(await localChangesSince(f.config, undefined, head), []);
  NodeAssert.deepEqual(await localChangesSince(f.config, "0".repeat(40), head), []);
});
