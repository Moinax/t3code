/**
 * The fork's migrations, in a ledger of their own.
 *
 * Upstream's migrator keys on `migration_id` and runs only the ids above the
 * highest one a database has recorded. Every id the fork claims first is
 * therefore an id at which upstream's own migration is later skipped without a
 * word — the fork spent five releases discovering that one id at a time, and
 * each discovery cost another compatibility migration to replay what had been
 * missed. `fork_sql_migrations` ends it: the fork numbers its migrations from 1
 * in a space upstream never writes to, and `effect_sql_migrations` goes back to
 * meaning exactly what upstream put there.
 *
 * Databases written before the split are reconciled around the two runs, off
 * the closed list of names the fork ever wrote to upstream's ledger:
 *
 * - before upstream's migrator, the fork's history moves out of its ledger —
 *   what the fork already ran is adopted into the fork ledger, and the ids it
 *   took beyond upstream's last migration are released, so upstream's next
 *   migration is not skipped for sitting under one of them;
 * - after the fork's migrator, the ids it took inside upstream's manifest are
 *   given back their upstream name, which the repair chain has just made true.
 *
 * The chain itself keeps the file names it was published under. Those numbers
 * are the upstream ids it was wedged between, not its order here.
 */
import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ForkUpstreamIdCompatibility from "./Migrations/059_ForkOrchestrationV2Compatibility.ts";

export const FORK_MIGRATIONS_TABLE = "fork_sql_migrations";

export const forkMigrationEntries = [
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
 * Every name the fork has recorded in upstream's ledger, across its releases.
 *
 * Closed by the split: no fork migration will ever be written there again. A
 * name this list does not hold is upstream's, including one from a build newer
 * than this one — those rows are left exactly as they are, since nothing here
 * can know whether replaying what they stand for is safe.
 */
const FORK_RECORDED_NAMES: ReadonlySet<string> = new Set([
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
 * The upstream ids the repair chain replays.
 *
 * What makes a name correctable: at one of these ids, upstream's migration has
 * run whatever the row says, so the row can be given upstream's name for it.
 * Outside this range a wrong name is left alone — 46 and 47 are in it on no
 * released fork database, and nothing here can replay them.
 *
 * Fixed with the chain. A fork migration written after the split is in its own
 * ledger and masks nothing.
 */
const CHAIN_REPLAYED_IDS: ReadonlySet<number> = new Set([
  43, 44, 45, 48, 49, 50, 51, 52, 53, 54, 55, 56,
]);

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
 * Move the fork's history out of upstream's ledger, before upstream's migrator
 * reads it.
 *
 * Adoption first: a fork migration upstream's ledger shows as run is recorded
 * in the fork ledger, so the split does not replay it. Then the ids past
 * upstream's last migration are dropped — upstream's next one lands there, and
 * the migrator would skip it for sitting below a recorded id.
 */
export const reconcileForkMigrationLedger = Effect.fn("reconcileForkMigrationLedger")(function* (
  upstreamNames: ReadonlyMap<number, string>,
) {
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
  const lastUpstreamId = Math.max(...upstreamNames.keys());
  const released = forkRows
    .filter((row) => row.migration_id > lastUpstreamId)
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
 * Give the ids the repair chain covers their upstream name.
 *
 * The chain has just replayed upstream's migration at each of them, so the name
 * it writes is accurate — and the ledger stops reporting a divergence that has
 * in fact been repaired. Fork releases left those ids under several shapes:
 * their own `*Compatibility` names, and upstream names copied to the wrong id.
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
