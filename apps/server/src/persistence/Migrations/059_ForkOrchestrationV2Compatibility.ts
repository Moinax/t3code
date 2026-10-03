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
// Gated, not run unconditionally like the rest of this chain: 055 creates its
// tables with bare `CREATE TABLE`, so replaying it where it already ran fails.
// The gate asks the schema rather than the ledger, because the ledger is the
// thing that is wrong on the databases this repair exists for — an id can carry
// the fork's name while upstream's migration has in fact been replayed under it.
export default Effect.gen(function* () {
  yield* repairForkHistory;

  const sql = yield* SqlClient.SqlClient;
  const v2Tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_events'
  `;
  if (v2Tables.length > 0) return;

  yield* orchestrationV2;
  yield* removeRedundantProjectionIndexes;
});
