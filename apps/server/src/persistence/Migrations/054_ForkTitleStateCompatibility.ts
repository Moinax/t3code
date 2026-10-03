import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import migrateTitleState from "./052_ProjectionThreadTitleState.ts";
import repairForkHistory from "./053_ForkMessageContextCompatibility.ts";

// Released fork databases already recorded IDs 52 and 53, so they skip
// upstream's title-state migration. Repair them at the next unused ID.
//
// Upstream adds the column with a bare ALTER TABLE, which fails on a database
// that reached it the other way. The guard belongs to the replay, not to
// upstream's migration: on upstream's own path the column cannot already exist.
export default Effect.gen(function* () {
  yield* repairForkHistory;

  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (columns.some((column) => column.name === "title_state_json")) return;

  yield* migrateTitleState;
});
