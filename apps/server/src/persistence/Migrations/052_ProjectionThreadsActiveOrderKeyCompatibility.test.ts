import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrateSessionStatusDetail from "./049_ProjectionThreadSessionStatusDetail.ts";

it.layer(NodeSqliteClient.layerMemory())(
  "052_ProjectionThreadsActiveOrderKeyCompatibility",
  (it) => {
    it.effect("repairs fork databases that recorded migrations 49 through 51", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 48 });
        yield* migrateSessionStatusDetail;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES
            (49, 'ProjectionThreadSessionStatusDetail'),
            (50, 'ForkMigrationCompatibility'),
            (51, 'ProjectionThreadsActiveOrderKeyCompatibility')
        `;

        yield* runMigrations({ toMigrationInclusive: 52 });

        const threadColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_threads)
        `;
        assert.ok(threadColumns.some((column) => column.name === "active_order_key"));

        const pullRequestTables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'projection_thread_pull_requests'
        `;
        assert.strictEqual(pullRequestTables.length, 1);

        const sessionColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_thread_sessions)
        `;
        assert.ok(sessionColumns.some((column) => column.name === "status_detail"));
      }),
    );
  },
);
