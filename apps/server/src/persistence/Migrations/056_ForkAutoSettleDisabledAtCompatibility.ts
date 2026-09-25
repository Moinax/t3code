import * as Effect from "effect/Effect";

import migrateAutoSettleDisabledAt from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";
import repairForkHistory from "./055_ForkPullRequestFilesViewedCompatibility.ts";

// Released fork databases already recorded IDs 54 and 55 before upstream
// assigned 54 to per-thread auto-settle state. Repair both histories at a new ID.
export default Effect.gen(function* () {
  yield* repairForkHistory;
  yield* migrateAutoSettleDisabledAt;
});
