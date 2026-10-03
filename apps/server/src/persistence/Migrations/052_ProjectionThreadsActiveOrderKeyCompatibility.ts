import * as Effect from "effect/Effect";

import migrateActiveOrderKey from "./049_ProjectionThreadsActiveOrderKey.ts";
import repairForkMigrationHistory from "./051_ForkMigrationCompatibility.ts";

/**
 * Fork databases may have recorded migrations through 51 before upstream
 * assigned IDs 49 and 50. Repeat the compatibility repair and active ordering
 * at a fresh ID that every earlier fork database will run.
 */
export default Effect.gen(function* () {
  yield* repairForkMigrationHistory;
  yield* migrateActiveOrderKey;
});
