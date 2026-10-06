import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

const upstreamLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
});

const forkLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM fork_sql_migrations ORDER BY migration_id
  `;
});

const v2Tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return tables.map(({ name }) => name);
});

/**
 * The ledger this machine's own database carries, read off it: five releases of
 * fork repairs recorded in upstream's ledger, at upstream's ids, under their
 * own names and under upstream names copied to the wrong id. 46 and 47 are the
 * only two the fork never touched.
 */
const PRE_SPLIT_LEDGER = [
  [43, "ProjectionThreadSessionStatusDetail"],
  [44, "ProjectionThreadSessionStatusDetail"],
  [45, "ProjectionThreadsUnsettledAtCompatibility"],
  [46, "RepairAutomaticSettlementTimestamps"],
  [47, "ProjectionProjectIcon"],
  [48, "ProjectionThreadSessionStatusDetail"],
  [49, "ForkMigrationCompatibility"],
  [50, "ForkMigrationCompatibility"],
  [51, "ProjectionThreadsActiveOrderKeyCompatibility"],
  [52, "ProjectionThreadsActiveOrderKeyCompatibility"],
  [53, "ForkMessageContextCompatibility"],
  [54, "ForkTitleStateCompatibility"],
  [55, "ForkPullRequestFilesViewedCompatibility"],
  [56, "ForkAutoSettleDisabledAtCompatibility"],
  [57, "ForkPullRequestFilesViewedCompatibility"],
  [58, "ForkAutoSettleDisabledAtCompatibility"],
  [59, "ForkOrchestrationV2Compatibility"],
] as const;

/**
 * Turn a fully migrated database back into that shape: the schema the repairs
 * produced, the ledger they left, and no fork ledger at all.
 */
const emulatePreSplitForkDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS fork_sql_migrations`;
  yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 43`;
  yield* Effect.forEach(
    PRE_SPLIT_LEDGER,
    ([id, name]) =>
      sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`,
  );
});

it.effect("hands upstream back the ids a pre-split fork database took", () =>
  Effect.gen(function* () {
    // Only as far as the split: the migrations upstream has added above it
    // never ran on a pre-split fork database, whose ledger sits on their ids.
    yield* runMigrations({ toMigrationInclusive: 56 });
    yield* emulatePreSplitForkDatabase;
    // The repair had run on such a database, so its schema is complete.
    assert.ok((yield* v2Tables).includes("orchestration_v2_events"));

    // The ids the fork took past the split are released, so upstream's own
    // migrations above it run instead of being skipped for sitting under one
    // of them. The repair is recognised from the row upstream's ledger carries.
    assert.deepStrictEqual(yield* runMigrations(), [
      [57, "ScheduledTaskWebhooks"],
      [58, "WebhookRelayDeliveries"],
    ]);
    assert.deepStrictEqual(yield* forkLedger, [
      { migration_id: 1, name: "ForkUpstreamIdCompatibility" },
    ]);

    const ledger = yield* upstreamLedger;
    assert.deepStrictEqual(
      ledger.filter(({ migration_id }) => migration_id >= 43),
      migrationManifest
        .filter(([id]) => id >= 43)
        .map(([migration_id, name]) => ({ migration_id, name })),
      "every id the fork took is upstream's again, by name and by migration",
    );
    assert.ok((yield* v2Tables).includes("orchestration_v2_events"));
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("still repairs a pre-split database that stopped before the repair", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* runMigrations({ toMigrationInclusive: 50 });
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
    assert.deepStrictEqual(yield* v2Tables, []);

    // Upstream's run reports only the migrations it has added above the ids
    // this database holds, while the fork's repair is what creates the schema
    // it was missing.
    assert.deepStrictEqual(yield* runMigrations(), [
      [57, "ScheduledTaskWebhooks"],
      [58, "WebhookRelayDeliveries"],
    ]);
    assert.ok((yield* v2Tables).includes("orchestration_v2_events"));
    assert.deepStrictEqual(yield* forkLedger, [
      { migration_id: 1, name: "ForkUpstreamIdCompatibility" },
    ]);
    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("leaves a migration from a newer build recorded", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* runMigrations();
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES (59, 'AMigrationThisBuildHasNeverHeardOf')
    `;

    assert.deepStrictEqual(yield* runMigrations(), []);
    assert.deepStrictEqual((yield* upstreamLedger).at(-1), {
      migration_id: 59,
      name: "AMigrationThisBuildHasNeverHeardOf",
    });
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
