import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import orchestrationV2 from "../Migrations/055_OrchestrationV2.ts";
import removeRedundantProjectionIndexes from "../Migrations/056_RemoveRedundantProjectionIndexes.ts";
import repairForkHistory from "./058_ForkAutoSettleDisabledAtCompatibility.ts";

// Released fork databases recorded 55 and 56 before upstream took them for the orchestrator,
// so upstream's 055, which creates every orchestration_v2_* table, was skipped. Gated on the
// schema, not the ledger the repair exists to fix: 055's bare `CREATE TABLE` fails on replay.
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
