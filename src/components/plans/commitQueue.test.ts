import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CommitAttemptResult,
  createPlanCommitQueue,
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
