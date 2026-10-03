import * as Effect from "effect/Effect";

import migratePullRequestFilesViewed from "./053_PullRequestFilesViewed.ts";
import repairForkHistory from "./054_ForkTitleStateCompatibility.ts";

// Released fork databases already recorded IDs 53 and 54 before upstream
// assigned 53 to pull-request file state. Repair both histories at a new ID.
export default Effect.gen(function* () {
  yield* repairForkHistory;
  yield* migratePullRequestFilesViewed;
});
