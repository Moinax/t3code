import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ForgejoKeyStore from "./ForgejoKeyStore.ts";

function layerWithKeysFile(contents: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const keysPath = yield* fileSystem.makeTempFileScoped({ prefix: "forgejo-keys-" });
    yield* fileSystem.writeFileString(keysPath, contents);
    return ForgejoKeyStore.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { T3CODE_FORGEJO_KEYS_PATH: keysPath } }),
        ),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
  });
}

const sampleKeys = JSON.stringify({
  hosts: {
    "codeberg.org": { type: "OAuth", name: "pat-s", token: "oauth-token" },
    "git.example.org": { type: "Token", name: "pat-s", token: "pat-token" },
  },
});

it.effect("lists hosts and returns credentials", () =>
  Effect.gen(function* () {
    const layer = yield* layerWithKeysFile(sampleKeys);
    yield* Effect.gen(function* () {
      const store = yield* ForgejoKeyStore.ForgejoKeyStore;
      const hosts = yield* store.listHosts;
      assert.deepStrictEqual([...hosts].toSorted(), ["codeberg.org", "git.example.org"]);

      const oauth = yield* store.getCredential("codeberg.org");
      assert.ok(oauth);
      assert.deepStrictEqual(store.authHeader(oauth), ["Authorization", "Bearer oauth-token"]);

      const pat = yield* store.getCredential("git.example.org");
      assert.ok(pat);
      assert.deepStrictEqual(store.authHeader(pat), ["Authorization", "token pat-token"]);

      assert.strictEqual(yield* store.getCredential("missing.example.org"), null);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("matches a bare-hostname credential when the lookup host carries a port", () =>
  Effect.gen(function* () {
    const layer = yield* layerWithKeysFile(sampleKeys);
    yield* Effect.gen(function* () {
      const store = yield* ForgejoKeyStore.ForgejoKeyStore;
      const credential = yield* store.getCredential("git.example.org:3000");
      assert.ok(credential);
      assert.strictEqual(credential.token, "pat-token");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("degrades to an empty store on malformed JSON", () =>
  Effect.gen(function* () {
    const layer = yield* layerWithKeysFile("{ not valid json");
    yield* Effect.gen(function* () {
      const store = yield* ForgejoKeyStore.ForgejoKeyStore;
      assert.deepStrictEqual(yield* store.listHosts, []);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it("keeps valid credentials while ignoring malformed entries", () => {
  const parsed = ForgejoKeyStore.parseKeysFile(
    JSON.stringify({
      hosts: {
        "valid.example": { type: "Token", name: "owner", token: "secret" },
        "missing-token.example": { type: "Token", name: "owner" },
        "blank-token.example": { type: "OAuth", name: "owner", token: "  " },
      },
    }),
  );

  assert.deepStrictEqual([...parsed.keys()], ["valid.example"]);
  assert.strictEqual(parsed.get("valid.example")?.token, "secret");
});

it("reads the Application login format emitted by fj v0.6", () => {
  const parsed = ForgejoKeyStore.parseKeysFile(
    JSON.stringify({
      hosts: {
        "git.example.org": { type: "Application", name: null, token: "secret" },
      },
    }),
  );

  const credential = parsed.get("git.example.org");
  assert.deepStrictEqual(credential, {
    host: "git.example.org",
    type: "Application",
    token: "secret",
  });
});
