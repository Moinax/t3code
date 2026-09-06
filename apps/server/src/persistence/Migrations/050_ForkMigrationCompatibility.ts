import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ClearAutomaticProjectModelDefaults from "./044_ClearAutomaticProjectModelDefaults.ts";
import ProjectionProjectsAutoPull from "./045_ProjectionProjectsAutoPull.ts";
import ProjectionThreadBranchPullRequest from "./048_ProjectionThreadBranchPullRequest.ts";
import ProjectionThreadSessionStatusDetail from "./049_ProjectionThreadSessionStatusDetail.ts";
import ProjectionThreadPullRequests from "./050_ProjectionThreadPullRequests.ts";

/**
 * Repair databases that recorded fork migrations 43 through 45 and 48 before
 * upstream assigned those IDs. Some fork releases also recorded the original
 * compatibility repair as migration 49. Repeat every skipped effect at 50.
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
