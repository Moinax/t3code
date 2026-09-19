import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import repairForkHistory from "./052_ProjectionThreadsActiveOrderKeyCompatibility.ts";

for (const source of ["fork", "upstream", "fresh"] as const) {
  it.effect(`migrates a ${source} database with message context and fork session status`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      if (source === "fork") {
        yield* runMigrations({ toMigrationInclusive: 50 });
        yield* repairForkHistory;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (51, 'ForkMigrationCompatibility'),
                 (52, 'ProjectionThreadsActiveOrderKeyCompatibility')
        `;
      } else if (source === "upstream") {
        yield* runMigrations({ toMigrationInclusive: 51 });
      }

      const applied = yield* runMigrations();
      assert.ok(applied.some(([id]) => id === 53));

      const messageColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.ok(messageColumns.some((column) => column.name === "context_json"));

      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_sessions)
      `;
      assert.ok(sessionColumns.some((column) => column.name === "status_detail"));

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(threadColumns.some((column) => column.name === "active_order_key"));

      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
}
