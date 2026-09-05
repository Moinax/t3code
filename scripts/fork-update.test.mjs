import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import {
  commandRunner,
  prepareUpdate,
  installArtifact,
  reconcileState,
  saveState,
  readState,
} from "./fork-update.mjs";
const exec = NodeUtil.promisify(NodeChildProcess.execFile);
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
        await NodeFSP.mkdir(NodePath.join(config.workDir, "release"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(config.workDir, "release/app.AppImage"), "new app");
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
    tools: { vp: "vp", codex: "codex" },
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
    NodeAssert.equal(await git(f.config.repo, "rev-parse", "HEAD"), f.original);
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
  "a conflict invokes the configured agent, then verifies its completed rebase",
  async (t) => {
    const f = await fixture(t, true);
    const run = async (command, args, options) => {
      if (command !== "codex") return f.run(command, args, options);
      NodeAssert.ok(args.includes("gpt-5.6-sol"));
      NodeAssert.ok(args.includes('model_reasoning_effort="high"'));
      NodeAssert.ok(args.includes('service_tier="fast"'));
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
      if (command === "codex") {
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
      if (command === "codex") {
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
        "console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Resolved the conflict'}}))",
      ],
      { agent: true },
    );
    const text = await NodeFSP.readFile(log, "utf8");
    NodeAssert.match(text, /build failed/);
    NodeAssert.match(text, /Resolved the conflict/);
  },
);
