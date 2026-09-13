import * as Effect from "effect/Effect";

import migrateMessageContext from "./051_ProjectionThreadMessageContext.ts";
import repairForkHistory from "./052_ProjectionThreadsActiveOrderKeyCompatibility.ts";

// Released fork databases already recorded IDs 51 and 52, so they skip
// upstream's new message-context migration. Repair them at the next unused ID.
export default Effect.gen(function* () {
  yield* repairForkHistory;
  yield* migrateMessageContext;
});
