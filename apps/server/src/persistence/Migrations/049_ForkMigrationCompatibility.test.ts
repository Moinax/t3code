import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("049_ForkMigrationCompatibility", (it) => {
  it.effect("repairs databases that recorded the fork's collided migration IDs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });

      yield* sql`
        ALTER TABLE projection_thread_sessions
        ADD COLUMN status_detail TEXT
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (43, 'ProjectionThreadSessionStatusDetail'),
          (44, 'ProjectionThreadSessionStatusDetail'),
          (45, 'ProjectionThreadsUnsettledAtCompatibility')
      `;

      yield* runMigrations({ toMigrationInclusive: 49 });

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(threadColumns.some((column) => column.name === "unsettled_at"));

      const sessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_sessions)
      `;
      assert.ok(sessionColumns.some((column) => column.name === "status_detail"));

      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.ok(projectColumns.some((column) => column.name === "auto_pull"));
      assert.ok(projectColumns.some((column) => column.name === "project_icon_json"));
    }),
  );
});
