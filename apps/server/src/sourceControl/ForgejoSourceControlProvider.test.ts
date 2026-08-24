import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ForgejoApi from "./ForgejoApi.ts";
import { discovery, make, parseForgejoAuthHosts } from "./ForgejoSourceControlProvider.ts";

const authOutput = ["pat-s@codeberg.org", "pat-s@git.example.org"].join("\n");

describe("Forgejo discovery", () => {
  it("parses `fj auth list` user@host lines", () => {
    assert.deepStrictEqual(parseForgejoAuthHosts(authOutput), [
      { account: "pat-s", host: "codeberg.org" },
      { account: "pat-s", host: "git.example.org" },
    ]);
  });

  it("parses the host-only output emitted by fj v0.6", () => {
    assert.deepStrictEqual(parseForgejoAuthHosts("git.o27.io\n"), [{ host: "git.o27.io" }]);

    const auth = discovery.parseAuth({
      stdout: "git.o27.io\n",
      stderr: "",
      exitCode: ChildProcessSpawner.ExitCode(0),
    });
    assert.strictEqual(auth.status, "authenticated");
    assert.strictEqual(Option.getOrNull(auth.account), null);
    assert.strictEqual(Option.getOrNull(auth.host), "git.o27.io");
  });

  it("refines an unknown remote whose host is logged in", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "git.example.org", baseUrl: "https://git.example.org" },
        remoteName: "origin",
        remoteUrl: "git@git.example.org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.org",
    });
  });

  it("refines an unknown remote whose host differs only in case", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "Git.Example.Org", baseUrl: "https://Git.Example.Org" },
        remoteName: "origin",
        remoteUrl: "git@Git.Example.Org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://Git.Example.Org",
    });
  });

  it("refines a remote whose host carries a port not present in the login store", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: {
          kind: "unknown",
          name: "git.example.org:3000",
          baseUrl: "https://git.example.org:3000",
        },
        remoteName: "origin",
        remoteUrl: "https://git.example.org:3000/owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.org:3000",
    });
  });

  it("keeps an authenticated LAN remote on HTTP", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: {
          kind: "unknown",
          name: "git.example.org:3000",
          baseUrl: "http://git.example.org:3000",
        },
        remoteName: "lan",
        remoteUrl: "http://git.example.org:3000/owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "http://git.example.org:3000",
    });
  });

  it("does not refine a host that is not logged in", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "git.other.org", baseUrl: "https://git.other.org" },
        remoteName: "origin",
        remoteUrl: "git@git.other.org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.strictEqual(refined, null);
  });

  it("reports authenticated status from auth output", () => {
    const auth = discovery.parseAuth({
      stdout: authOutput,
      stderr: "",
      exitCode: ChildProcessSpawner.ExitCode(0),
    });
    assert.strictEqual(auth.status, "authenticated");
  });

  it.effect("does not transport nested API causes that could contain credentials", () =>
    Effect.gen(function* () {
      const secret = "super-secret-forgejo-token";
      const provider = yield* make.pipe(
        Effect.provide(
          Layer.mock(ForgejoApi.ForgejoApi)({
            getPullRequest: () =>
              Effect.fail(
                new ForgejoApi.ForgejoApiError({
                  operation: "getPullRequest",
                  detail: "Forgejo returned HTTP 401.",
                  status: 401,
                  cause: new Error(secret),
                }),
              ),
          }),
        ),
      );

      const error = yield* provider
        .getChangeRequest({ cwd: "/repo", reference: "42" })
        .pipe(Effect.flip);
      assert.strictEqual(String(error).includes(secret), false);
      assert.strictEqual(error.cause, undefined);
    }),
  );
});
