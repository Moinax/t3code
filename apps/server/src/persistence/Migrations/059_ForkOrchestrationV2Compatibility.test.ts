import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import repairForkHistory from "./058_ForkAutoSettleDisabledAtCompatibility.ts";

const V2_TABLES = ["orchestration_v2_events", "orchestration_v2_projection_threads"] as const;

const v2Tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return tables.map(({ name }) => name);
});

// The shape every fork release before upstream's new orchestrator left behind:
// the fork's own compatibility migrations own ids 55 and 56.
it.effect("creates the V2 schema on a fork database that recorded 55 and 56 itself", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* runMigrations({ toMigrationInclusive: 50 });
    yield* repairForkHistory;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES
        (51, 'ForkMigrationCompatibility'),
        (52, 'ProjectionThreadsActiveOrderKeyCompatibility'),
        (53, 'ForkMessageContextCompatibility'),
        (54, 'ForkTitleStateCompatibility'),
        (55, 'ForkPullRequestFilesViewedCompatibility'),
        (56, 'ForkAutoSettleDisabledAtCompatibility')
    `;
    // Exactly what made this migration necessary: upstream's 055 never ran, so
    // nothing the app reads from the new orchestrator exists yet.
    assert.deepStrictEqual(yield* v2Tables, []);

    assert.deepStrictEqual(yield* runMigrations(), [
      [57, "ForkPullRequestFilesViewedCompatibility"],
      [58, "ForkAutoSettleDisabledAtCompatibility"],
      [59, "ForkOrchestrationV2Compatibility"],
    ]);
    for (const table of V2_TABLES) {
      assert.ok((yield* v2Tables).includes(table), table);
    }
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

// A database that ran upstream's 055 at its own id must not replay it: the
// migration creates its tables with bare CREATE TABLE and would fail.
it.effect("leaves an upstream database alone, where 055 already ran", () =>
  Effect.gen(function* () {
    yield* runMigrations();
    for (const table of V2_TABLES) {
      assert.ok((yield* v2Tables).includes(table), table);
    }
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
