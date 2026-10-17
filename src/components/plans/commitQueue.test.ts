import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CommitAttemptResult,
  createPlanCommitQueue,
  createPlanPatchController,
  type EditablePlanRecord,
  type PlanPatch,
} from "./commitQueue.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (val: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("commitQueue serializes A then B in order while A is in flight and ignores stale response for A", async () => {
  const serverReceived: number[] = [];
  const inFlightCalls: {
    value: number;
    seq: number;
    isCurrent: () => boolean;
    gate: Deferred<CommitAttemptResult<{ targetPrice: number }>>;
  }[] = [];
  const appliedSuccesses: number[] = [];
  const rollbacks: number[] = [];

  let publishedPlanPrice = 10_000;
  let uiSliderPrice = 10_000;

  const queue = createPlanCommitQueue<number, { targetPrice: number }>({
    initialValue: 10_000,
    send: async (_planId, value, meta) => {
      serverReceived.push(value);
      const gate = deferred<CommitAttemptResult<{ targetPrice: number }>>();
      inFlightCalls.push({ value, seq: meta.seq, isCurrent: meta.isCurrent, gate });
      const res = await gate.promise;
      // Simulate AccountProvider.updatePlan checking meta.isCurrent() before publishing response
      if (res.ok && res.data && meta.isCurrent()) {
        publishedPlanPrice = res.data.targetPrice;
      }
      return res;
    },
    onStateChange: (_planId, state) => {
      uiSliderPrice = state.value;
    },
    onSuccess: (_planId, value) => {
      appliedSuccesses.push(value);
    },
    onRollback: (_planId, rollbackVal) => {
      uiSliderPrice = rollbackVal;
      rollbacks.push(rollbackVal);
    },
  });

  // Issue commit A (8000)
  const commitAPromise = queue.commit("plan-1", 8_000, 10_000);
  assert.equal(serverReceived.length, 1);
  assert.deepEqual(serverReceived, [8_000]);
  assert.equal(uiSliderPrice, 8_000);
  assert.equal(queue.isBusy("plan-1"), true);

  // While A is still in flight, issue commit B (6500)
  const commitBPromise = queue.commit("plan-1", 6_500, 10_000);
  // B must NOT be sent while A is in flight
  assert.deepEqual(serverReceived, [8_000]);
  assert.equal(uiSliderPrice, 6_500);
  assert.equal(inFlightCalls[0].isCurrent(), false, "A is now stale because B was queued");

  // Resolve A with 8000; stale response for A must NOT replace state set by B
  inFlightCalls[0].gate.resolve({ ok: true, data: { targetPrice: 8_000 } });
  const outcomeA = await commitAPromise;
  assert.equal(outcomeA.superseded, true);
  assert.equal(outcomeA.applied, false);
  assert.equal(uiSliderPrice, 6_500, "Stale response for A must not overwrite UI state B");
  assert.equal(publishedPlanPrice, 10_000, "Stale response for A must not publish to AccountProvider");
  assert.deepEqual(appliedSuccesses, []);

  // Immediately after A settles, B is sent in order
  assert.deepEqual(serverReceived, [8_000, 6_500]);
  assert.equal(inFlightCalls.length, 2);
  assert.equal(inFlightCalls[1].isCurrent(), true);

  // Resolve B with 6500
  inFlightCalls[1].gate.resolve({ ok: true, data: { targetPrice: 6_500 } });
  const outcomeB = await commitBPromise;
  assert.equal(outcomeB.superseded, false);
  assert.equal(outcomeB.applied, true);
  assert.equal(uiSliderPrice, 6_500);
  assert.equal(publishedPlanPrice, 6_500);
  assert.deepEqual(appliedSuccesses, [6_500]);
  assert.deepEqual(rollbacks, []);
  assert.equal(queue.isBusy("plan-1"), false);
});

test("commitQueue coalesces intermediate commits while A is in flight so server receives only A then latest", async () => {
  const serverReceived: number[] = [];
  const gates: Deferred<CommitAttemptResult>[] = [];

  const queue = createPlanCommitQueue<number>({
    initialValue: 12_000,
    send: async (_planId, value) => {
      serverReceived.push(value);
      const gate = deferred<CommitAttemptResult>();
      gates.push(gate);
      return gate.promise;
    },
  });

  const pA = queue.commit("plan-1", 10_000, 12_000);
  const pB1 = queue.commit("plan-1", 9_000, 12_000);
  const pB2 = queue.commit("plan-1", 7_500, 12_000);

  // B1 was coalesced immediately when B2 arrived
  const outB1 = await pB1;
  assert.equal(outB1.superseded, true);
  assert.equal(outB1.applied, false);
  assert.deepEqual(serverReceived, [10_000]);

  gates[0].resolve({ ok: true });
  await pA;

  // Only B2 (7500) is sent after A
  assert.deepEqual(serverReceived, [10_000, 7_500]);
  gates[1].resolve({ ok: true });
  const outB2 = await pB2;
  assert.equal(outB2.applied, true);
  assert.equal(outB2.currentValue, 7_500);
});

test("failure of A does not roll back over B, and failure of B rolls back to last confirmed value", async () => {
  const serverReceived: number[] = [];
  const gates: Deferred<CommitAttemptResult>[] = [];
  const rollbacks: { value: number; error: string }[] = [];
  let uiValue = 10_000;

  const queue = createPlanCommitQueue<number>({
    initialValue: 10_000,
    send: async (_planId, value) => {
      serverReceived.push(value);
      const gate = deferred<CommitAttemptResult>();
      gates.push(gate);
      return gate.promise;
    },
    onStateChange: (_planId, state) => {
      uiValue = state.value;
    },
    onRollback: (_planId, rollbackValue, error) => {
      uiValue = rollbackValue;
      rollbacks.push({ value: rollbackValue, error });
    },
  });

  // Commit A (8000), then commit B (6000) while A is in flight
  const pA = queue.commit("plan-1", 8_000, 10_000);
  const pB = queue.commit("plan-1", 6_000, 10_000);
  assert.equal(uiValue, 6_000);

  // A fails! Must NOT roll back over B (6000)
  gates[0].resolve({ ok: false, error: "Network error on A" });
  const outA = await pA;
  assert.equal(outA.superseded, true);
  assert.equal(outA.rolledBack, false);
  assert.equal(uiValue, 6_000, "Failure of A must not roll back over B");
  assert.equal(rollbacks.length, 0);

  // B is now in flight
  assert.deepEqual(serverReceived, [8_000, 6_000]);

  // B succeeds -> final state is 6000
  gates[1].resolve({ ok: true });
  const outB = await pB;
  assert.equal(outB.applied, true);
  assert.equal(uiValue, 6_000);
  assert.equal(outB.confirmedValue, 6_000);

  // Now test C (5000) failing with no newer commit -> rolls back to confirmedValue (6000)
  const pC = queue.commit("plan-1", 5_000);
  assert.equal(uiValue, 5_000);
  gates[2].resolve({ ok: false, error: "Server error on C" });
  const outC = await pC;
  assert.equal(outC.rolledBack, true);
  assert.equal(uiValue, 6_000);
  assert.deepEqual(rollbacks, [{ value: 6_000, error: "Server error on C" }]);
});

test("failure of A does not roll back over a live local slider drag (setLocalValue)", async () => {
  const gates: Deferred<CommitAttemptResult>[] = [];
  const rollbacks: number[] = [];
  let uiValue = 10_000;

  const queue = createPlanCommitQueue<number>({
    initialValue: 10_000,
    send: async () => {
      const gate = deferred<CommitAttemptResult>();
      gates.push(gate);
      return gate.promise;
    },
    onStateChange: (_planId, state) => {
      uiValue = state.value;
    },
    onRollback: (_planId, rollbackValue) => {
      uiValue = rollbackValue;
      rollbacks.push(rollbackValue);
    },
  });

  const pA = queue.commit("plan-1", 8_500, 10_000);
  // User starts dragging slider to 7000 before releasing pointer
  queue.setLocalValue("plan-1", 7_000, 10_000);
  assert.equal(uiValue, 7_000);

  // Commit A fails while user is holding slider at 7000
  gates[0].resolve({ ok: false, error: "Failed A" });
  const outA = await pA;
  assert.equal(outA.rolledBack, false);
  assert.equal(uiValue, 7_000, "In-flight failure must not overwrite newer local drag");
  assert.deepEqual(rollbacks, []);
});

test("(a) slider A=8000 then B=6000 from 10000: A succeeds, B fails -> provider-visible plan targetPrice = 8000 (matches DB), UI value = 8000", async () => {
  let dbPlan: EditablePlanRecord = {
    id: "plan-1",
    alertEnabled: true,
    targetPrice: 10_000,
  };
  let providerPlans: EditablePlanRecord[] = [{ ...dbPlan }];
  const gates: {
    patch: PlanPatch;
    gate: Deferred<CommitAttemptResult<{ plan: EditablePlanRecord }>>;
  }[] = [];

  const controller = createPlanPatchController<
    EditablePlanRecord,
    { plan: EditablePlanRecord }
  >({
    initialPlans: [{ ...dbPlan }],
    send: async (_planId, patch) => {
      const gate = deferred<CommitAttemptResult<{ plan: EditablePlanRecord }>>();
      gates.push({ patch, gate });
      const res = await gate.promise;
      if (res.ok && res.data?.plan) {
        dbPlan = res.data.plan;
      }
      return res;
    },
    onPlansChange: (next) => {
      providerPlans = next;
    },
  });

  const card = controller.getPlanHandle("plan-1");

  // Commit A = 8000, then while A is in flight, commit B = 6000
  const pA = card.commitSlider(8_000);
  assert.equal(providerPlans[0].targetPrice, 8_000);
  assert.equal(card.getUiTargetPrice(), 8_000);

  const pB = card.commitSlider(6_000);
  assert.equal(providerPlans[0].targetPrice, 6_000);
  assert.equal(card.getUiTargetPrice(), 6_000);
  assert.equal(gates.length, 1, "B must wait while A is in flight");

  // A succeeds on server -> DB now holds 8000, but UI/provider stays at pending 6000
  gates[0].gate.resolve({
    ok: true,
    data: { plan: { ...dbPlan, targetPrice: 8_000 } },
  });
  const outA = await pA;
  assert.equal(outA.superseded, true);
  assert.equal(outA.confirmedValue.targetPrice, 8_000);
  assert.equal(dbPlan.targetPrice, 8_000);
  assert.equal(
    providerPlans[0].targetPrice,
    6_000,
    "Stale A success must not overwrite pending B",
  );
  assert.equal(card.getUiTargetPrice(), 6_000);

  // B is now in flight and fails on server -> must roll back to A's confirmed 8000 (NOT 10000)
  assert.equal(gates.length, 2);
  assert.deepEqual(gates[1].patch, { targetPrice: 6_000 });
  gates[1].gate.resolve({ ok: false, error: "Server failed on B" });
  const outB = await pB;

  assert.equal(outB.rolledBack, true);
  assert.equal(
    providerPlans[0].targetPrice,
    8_000,
    "Provider-visible plan targetPrice must roll back to confirmed 8000 (matching DB)",
  );
  assert.equal(card.getPlan()?.targetPrice, dbPlan.targetPrice);
  assert.equal(card.getUiTargetPrice(), 8_000);
  assert.equal(card.isSaving(), false);
});

test("(b) slider PATCH in flight, then limit toggled off (targetPrice null): toggle is queued behind slider write and final server/provider value is null", async () => {
  const serverLog: PlanPatch[] = [];
  const gates: Deferred<CommitAttemptResult<{ plan: EditablePlanRecord }>>[] = [];
  let dbPlan: EditablePlanRecord = {
    id: "plan-1",
    alertEnabled: true,
    targetPrice: 10_000,
  };
  let providerPlans: EditablePlanRecord[] = [{ ...dbPlan }];

  const controller = createPlanPatchController<
    EditablePlanRecord,
    { plan: EditablePlanRecord }
  >({
    initialPlans: [{ ...dbPlan }],
    send: async (_planId, patch) => {
      serverLog.push(patch);
      const gate = deferred<CommitAttemptResult<{ plan: EditablePlanRecord }>>();
      gates.push(gate);
      const res = await gate.promise;
      if (res.ok) {
        dbPlan = {
          ...dbPlan,
          ...(patch.alertEnabled !== undefined
            ? { alertEnabled: patch.alertEnabled }
            : {}),
          ...(patch.targetPrice !== undefined
            ? { targetPrice: patch.targetPrice }
            : {}),
        };
        return { ok: true, data: { plan: { ...dbPlan } } };
      }
      return res;
    },
    onPlansChange: (next) => {
      providerPlans = next;
    },
  });

  const card = controller.getPlanHandle("plan-1");

  // 1. Slider PATCH (8000) starts and is in flight
  const pSlider = card.commitSlider(8_000);
  assert.deepEqual(serverLog, [{ targetPrice: 8_000 }]);
  assert.equal(providerPlans[0].targetPrice, 8_000);

  // 2. While slider PATCH is in flight, user toggles price limit off (targetPrice: null)
  const pToggleOff = card.toggleLimit();
  // Must NOT send a concurrent PATCH while slider write is in flight
  assert.deepEqual(
    serverLog,
    [{ targetPrice: 8_000 }],
    "Limit toggle off must be queued behind the in-flight slider PATCH",
  );
  // Optimistic provider and UI value immediately reflect null
  assert.equal(providerPlans[0].targetPrice, null);
  assert.equal(card.getUiTargetPrice(), null);

  // 3. In-flight slider PATCH finishes -> server receives queued null PATCH next
  gates[0].resolve({ ok: true });
  await pSlider;
  assert.equal(
    providerPlans[0].targetPrice,
    null,
    "Stale slider response must not re-enable price limit",
  );
  assert.deepEqual(serverLog, [
    { targetPrice: 8_000 },
    { targetPrice: null },
  ]);

  // 4. Queued limit-off PATCH finishes -> final DB and provider targetPrice are both null
  gates[1].resolve({ ok: true });
  const outToggle = await pToggleOff;
  assert.equal(outToggle.applied, true);
  assert.equal(dbPlan.targetPrice, null);
  assert.equal(providerPlans[0].targetPrice, null);
  assert.equal(card.getUiTargetPrice(), null);
});

test("(c) closing and reopening the drawer (dropping and re-acquiring a per-plan handle) reuses the same queue with no concurrent PATCHes", async () => {
  const serverLog: PlanPatch[] = [];
  const gates: Deferred<CommitAttemptResult>[] = [];
  let inFlightCount = 0;
  let maxConcurrent = 0;

  const controller = createPlanPatchController({
    initialPlans: [
      { id: "plan-1", alertEnabled: true, targetPrice: 10_000 },
    ],
    send: async (_planId, patch) => {
      inFlightCount++;
      maxConcurrent = Math.max(maxConcurrent, inFlightCount);
      serverLog.push(patch);
      const gate = deferred<CommitAttemptResult>();
      gates.push(gate);
      try {
        return await gate.promise;
      } finally {
        inFlightCount--;
      }
    },
  });

  // Open drawer -> acquire handle 1, start slider PATCH (8500)
  const handle1 = controller.getPlanHandle("plan-1");
  const p1 = handle1.commitSlider(8_500);
  assert.equal(controller.getQueueCount(), 1);
  assert.equal(inFlightCount, 1);

  // Close drawer while p1 is still in flight -> drop handle 1
  handle1.dispose();

  // Reopen drawer -> acquire handle 2 for the same plan and issue another edit (7000)
  const handle2 = controller.getPlanHandle("plan-1");
  assert.equal(
    controller.getQueueCount(),
    1,
    "Reopening drawer must reuse the existing per-plan queue",
  );
  assert.equal(handle2.isSaving(), true);
  assert.equal(handle2.getUiTargetPrice(), 8_500);

  const p2 = handle2.commitSlider(7_000);
  assert.equal(
    inFlightCount,
    1,
    "Must not fire a concurrent PATCH after drawer close/reopen",
  );
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(serverLog, [{ targetPrice: 8_500 }]);

  // Complete first PATCH -> second PATCH is sent sequentially
  gates[0].resolve({ ok: true });
  await p1;
  assert.deepEqual(serverLog, [
    { targetPrice: 8_500 },
    { targetPrice: 7_000 },
  ]);
  assert.equal(maxConcurrent, 1);

  gates[1].resolve({ ok: true });
  await p2;
  assert.equal(controller.getPlan("plan-1")?.targetPrice, 7_000);
  assert.equal(handle2.isSaving(), false);

  // Clean up on plan deletion and signOut
  controller.removePlan("plan-1");
  assert.equal(controller.getQueueCount(), 0);
});

test("(d) alertEnabled toggle and targetPrice edits for the same plan go through the same queue in order and coalesce when pending", async () => {
  const serverLog: PlanPatch[] = [];
  const gates: Deferred<CommitAttemptResult>[] = [];

  const controller = createPlanPatchController({
    initialPlans: [
      { id: "plan-1", alertEnabled: true, targetPrice: 10_000 },
    ],
    send: async (_planId, patch) => {
      serverLog.push(patch);
      const gate = deferred<CommitAttemptResult>();
      gates.push(gate);
      return gate.promise;
    },
  });

  const handle = controller.getPlanHandle("plan-1");

  // 1. Toggle alertEnabled off (in flight)
  const pAlert = handle.toggleAlert();
  assert.deepEqual(serverLog, [{ alertEnabled: false }]);
  assert.equal(controller.getPlan("plan-1")?.alertEnabled, false);

  // 2. While alert PATCH is in flight, edit targetPrice to 7500 -> queued behind alert PATCH
  const pTarget1 = handle.commitSlider(7_500);
  assert.deepEqual(serverLog, [{ alertEnabled: false }]);
  assert.deepEqual(controller.getPlan("plan-1"), {
    id: "plan-1",
    alertEnabled: false,
    targetPrice: 7_500,
  });

  // 3. Resolve alert PATCH -> targetPrice PATCH is sent next in order
  gates[0].resolve({ ok: true });
  await pAlert;
  assert.deepEqual(serverLog, [
    { alertEnabled: false },
    { targetPrice: 7_500 },
  ]);

  // 4. While targetPrice (7500) is in flight, toggle alertEnabled back ON and update targetPrice to 6500
  // These two pending partial patches coalesce in order into { alertEnabled: true, targetPrice: 6500 }
  const pAlertOn = handle.toggleAlert();
  const pTarget2 = handle.commitSlider(6_500);
  const outCoalesced = await pAlertOn;
  assert.equal(outCoalesced.superseded, true);
  assert.deepEqual(controller.getPlan("plan-1"), {
    id: "plan-1",
    alertEnabled: true,
    targetPrice: 6_500,
  });

  gates[1].resolve({ ok: true });
  await pTarget1;

  assert.deepEqual(serverLog, [
    { alertEnabled: false },
    { targetPrice: 7_500 },
    { alertEnabled: true, targetPrice: 6_500 },
  ]);

  gates[2].resolve({ ok: true });
  const outFinal = await pTarget2;
  assert.equal(outFinal.applied, true);
  assert.deepEqual(controller.getPlan("plan-1"), {
    id: "plan-1",
    alertEnabled: true,
    targetPrice: 6_500,
  });
});

test("(e) a stale success response never overwrites a newer local value", async () => {
  const gates: Deferred<CommitAttemptResult<{ plan: EditablePlanRecord }>>[] = [];
  let providerPlans: EditablePlanRecord[] = [
    { id: "plan-1", alertEnabled: true, targetPrice: 10_000 },
  ];

  const controller = createPlanPatchController<
    EditablePlanRecord,
    { plan: EditablePlanRecord }
  >({
    initialPlans: [...providerPlans],
    send: async () => {
      const gate = deferred<CommitAttemptResult<{ plan: EditablePlanRecord }>>();
      gates.push(gate);
      return gate.promise;
    },
    onPlansChange: (next) => {
      providerPlans = next;
    },
  });

  const handle = controller.getPlanHandle("plan-1");

  // Commit A (8000) is in flight
  const pA = handle.commitSlider(8_000);
  assert.equal(providerPlans[0].targetPrice, 8_000);

  // User starts dragging slider to a newer local value (5500) before A finishes
  handle.setSliderDraft(5_500);
  assert.equal(providerPlans[0].targetPrice, 5_500);
  assert.equal(handle.getUiTargetPrice(), 5_500);

  // Stale success response for A (8000) arrives
  gates[0].resolve({
    ok: true,
    data: {
      plan: { id: "plan-1", alertEnabled: true, targetPrice: 8_000 },
    },
  });
  const outA = await pA;

  assert.equal(outA.superseded, true);
  assert.equal(outA.applied, false);
  // Confirmed baseline is updated to 8000, but current provider/UI value stays 5500
  assert.equal(controller.getConfirmedPlan("plan-1")?.targetPrice, 8_000);
  assert.equal(
    providerPlans[0].targetPrice,
    5_500,
    "Stale success for A must never overwrite newer local value 5500",
  );
  assert.equal(handle.getUiTargetPrice(), 5_500);
});

