import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrateMessageContext from "./053_ForkMessageContextCompatibility.ts";

it.effect("repairs a fork database that recorded migrations through 53", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* runMigrations({ toMigrationInclusive: 50 });
    yield* migrateMessageContext;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES
        (51, 'ForkMigrationCompatibility'),
        (52, 'ProjectionThreadsActiveOrderKeyCompatibility'),
        (53, 'ForkMessageContextCompatibility')
    `;

    const applied = yield* runMigrations();
    assert.deepStrictEqual(applied, [
      [54, "ProjectionThreadsAutoSettleDisabledAt"],
      [55, "ForkPullRequestFilesViewedCompatibility"],
    ]);

    const threadColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_threads)
    `;
    assert.ok(threadColumns.some((column) => column.name === "title_state_json"));
    assert.ok(threadColumns.some((column) => column.name === "active_order_key"));

    const messageColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_thread_messages)
    `;
    assert.ok(messageColumns.some((column) => column.name === "context_json"));

    const viewedTables = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'pull_request_files_viewed'
    `;
    assert.strictEqual(viewedTables.length, 1);

    assert.deepStrictEqual(yield* runMigrations(), []);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
