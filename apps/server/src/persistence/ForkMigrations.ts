/**
 * The fork's migrations live in `fork_sql_migrations`: upstream's migrator skips every id below
 * the highest recorded, so each id the fork took in `effect_sql_migrations` hid one of upstream's.
 * Pre-split databases are reconciled around the two runs. The chain keeps its published file
 * names; those numbers are the upstream ids it was wedged between, not its order here.
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import ForkUpstreamIdCompatibility from "./ForkMigrations/059_ForkOrchestrationV2Compatibility.ts";

const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

const forkMigrationEntries = [
  [1, "ForkUpstreamIdCompatibility", ForkUpstreamIdCompatibility],
] as const;

/**
 * The name each fork migration carried while it lived in upstream's ledger.
 *
 * How a database that already ran one is recognised. Closed, like the list
 * below: a fork migration written after the split has no such name.
 */
const PRE_SPLIT_NAMES: ReadonlyMap<number, string> = new Map([
  [1, "ForkOrchestrationV2Compatibility"],
]);

/**
 * Every name the fork ever recorded in upstream's ledger, closed by the split. Any other name is
 * upstream's, even from a newer build, and is left alone: nothing here knows if replaying it is safe.
 */
export const FORK_RECORDED_NAMES: ReadonlySet<string> = new Set([
  "ProjectionThreadsUnsettledAtCompatibility",
  "ForkMigrationCompatibility",
  "ProjectionThreadsActiveOrderKeyCompatibility",
  "ForkMessageContextCompatibility",
  "ForkTitleStateCompatibility",
  "ForkPullRequestFilesViewedCompatibility",
  "ForkAutoSettleDisabledAtCompatibility",
  "ForkOrchestrationV2Compatibility",
]);

/**
 * The upstream ids the repair chain replays, so a row there can take upstream's name. Outside
 * them a wrong name is left alone: 46 and 47 are on no released fork database and nothing here
 * replays them. Post-split fork migrations live in their own ledger and mask nothing.
 */
const CHAIN_REPLAYED_IDS: ReadonlySet<number> = new Set([
  43, 44, 45, 48, 49, 50, 51, 52, 53, 54, 55, 56,
]);

/**
 * Upstream's last migration id when the fork left its id space. Frozen, not derived from
 * `migrationEntries`: tracking upstream would make a fork row at 57 (since claimed upstream)
 * look like upstream's own and be kept, masking the migration this file exists to unblock.
 */
export const LAST_UPSTREAM_ID_AT_SPLIT = 56;

const run = Migrator.make({});

/**
 * Run the fork's pending migrations. Called after upstream's, so a fresh
 * database already has the schema the repair chain inspects.
 */
export const runForkMigrations = run({
  loader: Migrator.fromRecord(
    Object.fromEntries(
      forkMigrationEntries.map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  ),
  table: FORK_MIGRATIONS_TABLE,
});

const recordedRows = Effect.fn("recordedMigrationRows")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return [];
  return yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
});

/**
 * Before upstream's migrator: adopt what the fork already ran into the fork ledger, then drop
 * the ids past upstream's last migration at the split, which would mask upstream's next one.
 */
export const reconcileForkMigrationLedger = Effect.fn("reconcileForkMigrationLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const forkRows = (yield* recordedRows()).filter((row) => FORK_RECORDED_NAMES.has(row.name));
  if (forkRows.length === 0) return { adopted: [], released: [] };

  const recordedNames = new Set(forkRows.map((row) => row.name));
  const adopted = forkMigrationEntries.flatMap(([id, name]) => {
    const preSplitName = PRE_SPLIT_NAMES.get(id);
    return preSplitName !== undefined && recordedNames.has(preSplitName)
      ? [[id, name] as const]
      : [];
  });
  const released = forkRows
    .filter((row) => row.migration_id > LAST_UPSTREAM_ID_AT_SPLIT)
    .map((row) => row.migration_id);

  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (adopted.length > 0) {
        // Mirrors the migrator's own DDL for this table; both create it only if
        // it is absent, so either one may get there first.
        yield* sql`
          CREATE TABLE IF NOT EXISTS fork_sql_migrations (
            migration_id integer PRIMARY KEY NOT NULL,
            created_at datetime NOT NULL DEFAULT current_timestamp,
            name VARCHAR(255) NOT NULL
          )
        `;
        yield* Effect.forEach(
          adopted,
          ([id, name]) =>
            sql`INSERT OR IGNORE INTO fork_sql_migrations (migration_id, name) VALUES (${id}, ${name})`,
        );
      }
      if (released.length > 0) {
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id IN ${sql.in(released)}`;
      }
    }),
  );

  if (adopted.length > 0 || released.length > 0) {
    yield* Effect.logDebug("Took the fork's migration history out of upstream's ledger").pipe(
      Effect.annotateLogs({
        adopted: adopted.map(([id, name]) => `${id}_${name}`),
        released,
      }),
    );
  }
  return { adopted, released };
});

/**
 * The chain just replayed upstream's migration at each of these ids, so upstream's name is true
 * and the divergence report stops. Fork releases left them under `*Compatibility` names or
 * upstream names copied to the wrong id.
 */
export const restoreUpstreamMigrationNames = Effect.fn("restoreUpstreamMigrationNames")(function* (
  upstreamNames: ReadonlyMap<number, string>,
) {
  const sql = yield* SqlClient.SqlClient;
  const renamed = (yield* recordedRows()).flatMap((row) => {
    if (!CHAIN_REPLAYED_IDS.has(row.migration_id)) return [];
    const upstreamName = upstreamNames.get(row.migration_id);
    return upstreamName === undefined || upstreamName === row.name
      ? []
      : [{ id: row.migration_id, name: upstreamName }];
  });
  if (renamed.length === 0) return [];
  yield* sql.withTransaction(
    Effect.forEach(
      renamed,
      ({ id, name }) =>
        sql`UPDATE effect_sql_migrations SET name = ${name} WHERE migration_id = ${id}`,
    ),
  );
  yield* Effect.logDebug("Restored upstream migration names after the fork's repair").pipe(
    Effect.annotateLogs({ renamed: renamed.map(({ id, name }) => `${id}_${name}`) }),
  );
  return renamed;
});
