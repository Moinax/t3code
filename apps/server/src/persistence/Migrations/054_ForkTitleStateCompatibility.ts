import * as Effect from "effect/Effect";

import migrateTitleState from "./052_ProjectionThreadTitleState.ts";
import repairForkHistory from "./053_ForkMessageContextCompatibility.ts";

// Released fork databases already recorded IDs 52 and 53, so they skip
// upstream's title-state migration. Repair them at the next unused ID.
export default Effect.gen(function* () {
  yield* repairForkHistory;
  yield* migrateTitleState;
});
