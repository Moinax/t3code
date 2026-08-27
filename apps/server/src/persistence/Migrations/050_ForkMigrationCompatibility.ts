import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ClearAutomaticProjectModelDefaults from "./044_ClearAutomaticProjectModelDefaults.ts";
import ProjectionProjectsAutoPull from "./045_ProjectionProjectsAutoPull.ts";
import ProjectionThreadBranchPullRequest from "./048_ProjectionThreadBranchPullRequest.ts";
import ProjectionThreadSessionStatusDetail from "./049_ProjectionThreadSessionStatusDetail.ts";
import ProjectionThreadPullRequests from "./050_ProjectionThreadPullRequests.ts";

/**
 * Repair databases that recorded fork migrations before upstream assigned
 * the same IDs. The migrator skips the upstream migrations, so repeat their
 * idempotent effects at a new ID.
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
  yield* ProjectionThreadBranchPullRequest;
  yield* ProjectionThreadSessionStatusDetail;
  yield* ProjectionThreadPullRequests;
});
