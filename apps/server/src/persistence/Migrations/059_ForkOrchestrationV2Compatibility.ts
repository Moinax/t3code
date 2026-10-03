import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import orchestrationV2 from "./055_OrchestrationV2.ts";
import removeRedundantProjectionIndexes from "./056_RemoveRedundantProjectionIndexes.ts";
import repairForkHistory from "./058_ForkAutoSettleDisabledAtCompatibility.ts";

// Released fork databases recorded 55 and 56 under the fork's own compatibility
// migrations before upstream assigned those ids to the new orchestrator. The
// migrator only runs ids above the highest recorded one, so on those databases
// upstream's 055 and 056 are skipped without a word — and 055 is the one that
// creates every orchestration_v2_* table the app now reads. Replay them here, at
// an id above everything the fork released.
//
// Gated on the ledger, not run unconditionally like the rest of this chain:
// 055 creates its tables with bare `CREATE TABLE`, so replaying it where it
// already ran fails. The migrator inserts every pending row before running any
// of them, so by the time this executes, id 55 already names whichever migration
// owns it on this database.
export default Effect.gen(function* () {
  yield* repairForkHistory;

  const sql = yield* SqlClient.SqlClient;
  const recorded = yield* sql<{ readonly name: string }>`
    SELECT name FROM effect_sql_migrations WHERE migration_id = 55
  `;
  if (recorded[0]?.name === "OrchestrationV2") return;

  yield* orchestrationV2;
  yield* removeRedundantProjectionIndexes;
});
