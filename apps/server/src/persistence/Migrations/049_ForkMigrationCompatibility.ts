import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ClearAutomaticProjectModelDefaults from "./044_ClearAutomaticProjectModelDefaults.ts";
import ProjectionProjectsAutoPull from "./045_ProjectionProjectsAutoPull.ts";
import ProjectionThreadSessionStatusDetail from "./048_ProjectionThreadSessionStatusDetail.ts";

/**
 * Repair databases that ran the fork's former migrations 43 through 45 before
 * upstream assigned those IDs. The recorded IDs make the migrator skip the
 * upstream migrations, so repeat their idempotent effects at a new ID.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!threadColumns.some((column) => column.name === "unsettled_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN unsettled_at TEXT
    `;
  }

  yield* ClearAutomaticProjectModelDefaults;
  yield* ProjectionProjectsAutoPull;
  yield* ProjectionThreadSessionStatusDetail;
});
