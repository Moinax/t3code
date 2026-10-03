import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import migrateTitleState from "../Migrations/052_ProjectionThreadTitleState.ts";
import repairForkHistory from "./053_ForkMessageContextCompatibility.ts";

// Released fork databases recorded 52 and 53, skipping upstream's title-state migration.
// Upstream's bare ALTER TABLE fails where the column arrived another way, so the guard
// belongs to this replay, not to upstream's migration.
export default Effect.gen(function* () {
  yield* repairForkHistory;

  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (columns.some((column) => column.name === "title_state_json")) return;

  yield* migrateTitleState;
});
