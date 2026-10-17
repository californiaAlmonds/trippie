export interface CommitAttemptResult<R = unknown> {
  ok: boolean;
  status?: number;
  data?: R | null;
  error?: string | null;
}

export interface CommitOutcome<T, R = unknown, P = T> {
  /** Sequence number assigned to this commit. */
  seq: number;
  /** The resulting optimistic value requested for this commit. */
  value: T;
  /** The patch submitted for this commit. */
  patch: P;
  /** True when a newer commit or local edit superseded this commit before or while it was in flight. */
  superseded: boolean;
  /** True when this commit succeeded and its response was applied to state. */
  applied: boolean;
  /** True when this commit failed and rolled back to the last confirmed value. */
  rolledBack: boolean;
  /** Current local/UI value after handling this commit. */
  currentValue: T;
  /** Last server-confirmed value after handling this commit. */
  confirmedValue: T;
  /** Error message when the commit failed and triggered a rollback. */
  error?: string;
  /** Raw result returned by `send`. */
  result?: CommitAttemptResult<R>;
}

export interface PlanQueueState<T> {
  value: T;
  confirmedValue: T;
  saving: boolean;
  seq: number;
}

export interface PlanCommitQueueOptions<T, R = unknown, P = T> {
  /** Default confirmed value for a plan before its first commit. */
  initialValue?: T;
  /** Executes the network PATCH for `(planId, patch)`. */
  send: (
    planId: string,
    patch: P,
    meta: { seq: number; isCurrent: () => boolean },
  ) => Promise<CommitAttemptResult<R>>;
  /** Optional custom merger for combining two partial patches in order. */
  mergePatch?: (prevPatch: P, nextPatch: P) => P;
  /** Optional custom applier for overlaying a partial patch onto a value `T`. */
  applyPatch?: (base: T, patch: P) => T;
  /** Optional custom resolver to compute the new `confirmedValue` when a commit succeeds. */
  resolveConfirmed?: (
    appliedConfirmed: T,
    patch: P,
    result: CommitAttemptResult<R>,
    previousConfirmed: T,
  ) => T;
  /** Notified whenever a plan's value, confirmedValue, or saving flag changes. */
  onStateChange?: (planId: string, state: PlanQueueState<T>) => void;
  /** Notified when a non-stale commit succeeds and no newer local value exists. */
  onSuccess?: (
    planId: string,
    value: T,
    result: CommitAttemptResult<R>,
    seq: number,
    patch: P,
  ) => void;
  /** Notified when a non-stale commit fails and no newer local value exists, rolling back to `confirmedValue`. */
  onRollback?: (
    planId: string,
    rollbackValue: T,
    error: string,
    seq: number,
    patch: P,
  ) => void;
}

interface PendingTask<T, R, P> {
  patch: P;
  seq: number;
  resolve: (outcome: CommitOutcome<T, R, P>) => void;
}

interface PlanQueueEntry<T, R, P> {
  currentValue: T;
  confirmedValue: T;
  inFlightPatch: P | null;
  localPatch: P | null;
  latestSeq: number;
  resetGen: number;
  inFlight: boolean;
  pending: PendingTask<T, R, P> | null;
}

export interface PlanCommitQueue<T, R = unknown, P = T> {
  /** Enqueues a commit for `planId`. At most one request is in flight per plan; newer commits coalesce into a single pending slot. */
  commit: (
    planId: string,
    patch: P,
    baselineValue?: T,
  ) => Promise<CommitOutcome<T, R, P>>;
  /** Records a live local edit (e.g. slider drag before release) so any in-flight request is marked stale and cannot overwrite or roll back over it. */
  setLocalValue: (planId: string, patch: P, baselineValue?: T) => number;
  /** Syncs the server-confirmed value when no commit is in flight or pending for `planId`. */
  syncServerValue: (planId: string, confirmedValue: T) => void;
  /** Cancels any pending commit and invalidates any in-flight request for `planId`, resetting to `confirmedValue`. */
  cancel: (planId: string, confirmedValue: T) => void;
  /** Cancels any pending/in-flight work and removes the queue entry for `planId`. */
  remove: (planId: string) => void;
  /** Cancels and clears all queue entries. */
  clear: () => void;
  /** True when a commit is currently in flight or queued for `planId`. */
  isBusy: (planId: string) => boolean;
  /** True when `seq` is still the latest sequence number for `planId` and no pending commit is waiting. */
  isCurrentSeq: (planId: string, seq: number) => boolean;
  /** Returns a snapshot of the current queue state for `planId`. */
  getState: (planId: string, fallbackValue?: T) => PlanQueueState<T>;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export function mergePartialPatch<P>(prev: P, next: P): P {
  if (isPlainObject(prev) && isPlainObject(next)) {
    const out: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined) {
        out[k] = v;
      }
    }
    return out as P;
  }
  return next;
}

export function applyPartialPatch<T, P = Partial<T>>(base: T, patch: P): T {
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        out[k] = v;
      }
    }
    return out as T;
  }
  return patch as unknown as T;
}

function clearCommittedLocalPatch<P>(localPatch: P | null, committedPatch: P): P | null {
  if (localPatch === null) return null;
  if (isPlainObject(localPatch) && isPlainObject(committedPatch)) {
    const next: Record<string, unknown> = { ...localPatch };
    for (const [k, v] of Object.entries(committedPatch)) {
      if (v !== undefined) {
        delete next[k];
      }
    }
    return Object.keys(next).length > 0 ? (next as P) : null;
  }
  return null;
}

function isNoOpPatch<T, P>(confirmed: T, patch: P): boolean {
  if (isPlainObject(confirmed) && isPlainObject(patch)) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return true;
    return entries.every(([k, v]) => Object.is(confirmed[k], v));
  }
  return Object.is(patch, confirmed);
}

/**
 * Creates a pure per-plan commit queue/coalescer:
 * - Serializes commits per plan id (at most one PATCH in flight).
 * - Coalesces rapid commits while one is in flight (merges partial patches in order into a single pending slot and sends it after the current request settles).
 * - Tracks sequence numbers so stale responses are ignored for UI state while still updating `confirmedValue` when a superseded request succeeds on the server.
 * - Rolls back to the last confirmed value on failure only when no newer local value exists.
 */
export function createPlanCommitQueue<T = number, R = unknown, P = T>(
  options: PlanCommitQueueOptions<T, R, P>,
): PlanCommitQueue<T, R, P> {
  const entries = new Map<string, PlanQueueEntry<T, R, P>>();
  const mergePatch = options.mergePatch ?? mergePartialPatch<P>;
  const applyPatch = options.applyPatch ?? applyPartialPatch<T, P>;

  function recomputeCurrent(entry: PlanQueueEntry<T, R, P>): T {
    let next = entry.confirmedValue;
    if (entry.inFlight && entry.inFlightPatch !== null) {
      next = applyPatch(next, entry.inFlightPatch);
    }
    if (entry.pending !== null) {
      next = applyPatch(next, entry.pending.patch);
    }
    if (entry.localPatch !== null) {
      next = applyPatch(next, entry.localPatch);
    }
    entry.currentValue = next;
    return next;
  }

  function ensureEntry(planId: string, baselineValue?: T): PlanQueueEntry<T, R, P> {
    const key = String(planId);
    let entry = entries.get(key);
    if (!entry) {
      const init = (
        baselineValue !== undefined ? baselineValue : options.initialValue
      ) as T;
      entry = {
        currentValue: init,
        confirmedValue: init,
        inFlightPatch: null,
        localPatch: null,
        latestSeq: 0,
        resetGen: 0,
        inFlight: false,
        pending: null,
      };
      entries.set(key, entry);
    }
    return entry;
  }

  function emitState(planId: string, entry: PlanQueueEntry<T, R, P>): void {
    options.onStateChange?.(String(planId), {
      value: entry.currentValue,
      confirmedValue: entry.confirmedValue,
      saving: entry.inFlight || entry.pending !== null,
      seq: entry.latestSeq,
    });
  }

  function isEntryCurrent(
    entry: PlanQueueEntry<T, R, P>,
    seq: number,
    gen: number,
  ): boolean {
    return (
      entry.resetGen === gen &&
      entry.latestSeq === seq &&
      entry.pending === null &&
      entry.localPatch === null
    );
  }

  async function runLoop(
    planId: string,
    entry: PlanQueueEntry<T, R, P>,
    initialTask: PendingTask<T, R, P>,
  ): Promise<void> {
    const key = String(planId);
    entry.inFlight = true;
    entry.inFlightPatch = initialTask.patch;
    recomputeCurrent(entry);
    emitState(key, entry);

    let task: PendingTask<T, R, P> | null = initialTask;
    while (task) {
      const { patch, seq, resolve } = task;
      const startGen = entry.resetGen;
      const isCurrent = () => isEntryCurrent(entry, seq, startGen);
      const requestedValue = applyPatch(entry.confirmedValue, patch);

      let res: CommitAttemptResult<R>;
      try {
        res = await options.send(key, patch, { seq, isCurrent });
      } catch (err) {
        res = {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Could not update target price.",
        };
      }

      if (entry.resetGen !== startGen) {
        resolve({
          seq,
          value: requestedValue,
          patch,
          superseded: true,
          applied: false,
          rolledBack: false,
          currentValue: entry.currentValue,
          confirmedValue: entry.confirmedValue,
          result: res,
        });
        return;
      }

      const stillCurrent = isCurrent();
      if (res.ok) {
        const appliedConfirmed = applyPatch(entry.confirmedValue, patch);
        entry.confirmedValue = options.resolveConfirmed
          ? options.resolveConfirmed(
              appliedConfirmed,
              patch,
              res,
              entry.confirmedValue,
            )
          : appliedConfirmed;
        entry.inFlightPatch = null;
        recomputeCurrent(entry);

        if (stillCurrent) {
          options.onSuccess?.(key, entry.currentValue, res, seq, patch);
          resolve({
            seq,
            value: entry.confirmedValue,
            patch,
            superseded: false,
            applied: true,
            rolledBack: false,
            currentValue: entry.currentValue,
            confirmedValue: entry.confirmedValue,
            result: res,
          });
        } else {
          emitState(key, entry);
          resolve({
            seq,
            value: requestedValue,
            patch,
            superseded: true,
            applied: false,
            rolledBack: false,
            currentValue: entry.currentValue,
            confirmedValue: entry.confirmedValue,
            result: res,
          });
        }
      } else {
        entry.inFlightPatch = null;
        recomputeCurrent(entry);

        if (stillCurrent) {
          const errMsg = res.error ?? "Could not update target price.";
          options.onRollback?.(key, entry.confirmedValue, errMsg, seq, patch);
          resolve({
            seq,
            value: requestedValue,
            patch,
            superseded: false,
            applied: false,
            rolledBack: true,
            currentValue: entry.currentValue,
            confirmedValue: entry.confirmedValue,
            error: errMsg,
            result: res,
          });
        } else {
          emitState(key, entry);
          resolve({
            seq,
            value: requestedValue,
            patch,
            superseded: true,
            applied: false,
            rolledBack: false,
            currentValue: entry.currentValue,
            confirmedValue: entry.confirmedValue,
            result: res,
          });
        }
      }

      if (entry.pending) {
        task = entry.pending;
        entry.pending = null;
        entry.inFlightPatch = task.patch;
        recomputeCurrent(entry);
        emitState(key, entry);
      } else {
        task = null;
      }
    }

    entry.inFlight = false;
    entry.inFlightPatch = null;
    recomputeCurrent(entry);
    emitState(key, entry);
  }

  return {
    commit(
      planId: string,
      patch: P,
      baselineValue?: T,
    ): Promise<CommitOutcome<T, R, P>> {
      const key = String(planId);
      const entry = ensureEntry(
        key,
        baselineValue !== undefined
          ? baselineValue
          : (options.initialValue ?? (patch as unknown as T)),
      );

      entry.localPatch = clearCommittedLocalPatch(entry.localPatch, patch);

      if (
        !entry.inFlight &&
        entry.pending === null &&
        isNoOpPatch(entry.confirmedValue, patch)
      ) {
        recomputeCurrent(entry);
        emitState(key, entry);
        return Promise.resolve({
          seq: entry.latestSeq,
          value: entry.currentValue,
          patch,
          superseded: false,
          applied: false,
          rolledBack: false,
          currentValue: entry.currentValue,
          confirmedValue: entry.confirmedValue,
        });
      }

      const seq = ++entry.latestSeq;

      return new Promise<CommitOutcome<T, R, P>>((resolve) => {
        if (entry.inFlight) {
          let mergedPatch = patch;
          if (entry.pending) {
            const prevPending = entry.pending;
            mergedPatch = mergePatch(prevPending.patch, patch);
            const prevValue = applyPatch(entry.confirmedValue, prevPending.patch);
            entry.pending = { patch: mergedPatch, seq, resolve };
            recomputeCurrent(entry);
            prevPending.resolve({
              seq: prevPending.seq,
              value: prevValue,
              patch: prevPending.patch,
              superseded: true,
              applied: false,
              rolledBack: false,
              currentValue: entry.currentValue,
              confirmedValue: entry.confirmedValue,
            });
          } else {
            entry.pending = { patch: mergedPatch, seq, resolve };
            recomputeCurrent(entry);
          }
          emitState(key, entry);
          return;
        }

        const nextTask: PendingTask<T, R, P> = { patch, seq, resolve };
        void runLoop(key, entry, nextTask);
      });
    },

    setLocalValue(planId: string, patch: P, baselineValue?: T): number {
      const key = String(planId);
      const entry = ensureEntry(
        key,
        baselineValue !== undefined
          ? baselineValue
          : (options.initialValue ?? (patch as unknown as T)),
      );
      entry.localPatch =
        entry.localPatch !== null ? mergePatch(entry.localPatch, patch) : patch;
      entry.latestSeq++;
      recomputeCurrent(entry);
      emitState(key, entry);
      return entry.latestSeq;
    },

    syncServerValue(planId: string, confirmedValue: T): void {
      const key = String(planId);
      const entry = ensureEntry(key, confirmedValue);
      if (entry.inFlight || entry.pending !== null || entry.localPatch !== null) {
        return;
      }
      entry.confirmedValue = confirmedValue;
      entry.currentValue = confirmedValue;
    },

    cancel(planId: string, confirmedValue: T): void {
      const key = String(planId);
      const entry = ensureEntry(key, confirmedValue);
      entry.resetGen++;
      entry.latestSeq++;
      entry.confirmedValue = confirmedValue;
      entry.currentValue = confirmedValue;
      entry.inFlightPatch = null;
      entry.localPatch = null;
      if (entry.pending) {
        const prevPending = entry.pending;
        entry.pending = null;
        prevPending.resolve({
          seq: prevPending.seq,
          value: applyPatch(confirmedValue, prevPending.patch),
          patch: prevPending.patch,
          superseded: true,
          applied: false,
          rolledBack: false,
          currentValue: confirmedValue,
          confirmedValue,
        });
      }
      entry.inFlight = false;
      emitState(key, entry);
    },

    remove(planId: string): void {
      const key = String(planId);
      const entry = entries.get(key);
      if (!entry) return;
      entry.resetGen++;
      entry.latestSeq++;
      entry.inFlightPatch = null;
      entry.localPatch = null;
      if (entry.pending) {
        const prevPending = entry.pending;
        entry.pending = null;
        prevPending.resolve({
          seq: prevPending.seq,
          value: entry.currentValue,
          patch: prevPending.patch,
          superseded: true,
          applied: false,
          rolledBack: false,
          currentValue: entry.currentValue,
          confirmedValue: entry.confirmedValue,
        });
      }
      entry.inFlight = false;
      entries.delete(key);
    },

    clear(): void {
      for (const key of Array.from(entries.keys())) {
        this.remove(key);
      }
    },

    isBusy(planId: string): boolean {
      const entry = entries.get(String(planId));
      return Boolean(entry && (entry.inFlight || entry.pending !== null));
    },

    isCurrentSeq(planId: string, seq: number): boolean {
      const entry = entries.get(String(planId));
      if (!entry) return false;
      return (
        entry.latestSeq === seq &&
        entry.pending === null &&
        entry.localPatch === null
      );
    },

    getState(planId: string, fallbackValue?: T): PlanQueueState<T> {
      const entry = ensureEntry(String(planId), fallbackValue);
      return {
        value: entry.currentValue,
        confirmedValue: entry.confirmedValue,
        saving: entry.inFlight || entry.pending !== null,
        seq: entry.latestSeq,
      };
    },
  };
}

export interface PlanPatch {
  alertEnabled?: boolean;
  targetPrice?: number | null;
}

export interface EditablePlanRecord {
  id: string | number;
  alertEnabled: boolean;
  targetPrice: number | null;
}

export interface PlanHandle<
  TPlan extends EditablePlanRecord = EditablePlanRecord,
  R = unknown,
> {
  readonly planId: string;
  /** Returns the current provider-visible plan. */
  getPlan: () => TPlan | undefined;
  /** Returns the last server-confirmed plan. */
  getConfirmedPlan: () => TPlan | undefined;
  /** Returns the UI-visible targetPrice (null when limit is off, number when on). */
  getUiTargetPrice: () => number | null;
  /** True while a PATCH is in flight or queued for this plan. */
  isSaving: () => boolean;
  /** Enqueues a partial patch on this plan's queue. */
  patch: (partial: PlanPatch) => Promise<CommitOutcome<TPlan, R, PlanPatch>>;
  /** Records a live slider draft value without sending a network request yet. */
  setSliderDraft: (targetPrice: number) => number;
  /** Commits a slider target price through this plan's queue. */
  commitSlider: (
    targetPrice: number,
  ) => Promise<CommitOutcome<TPlan, R, PlanPatch>>;
  /** Toggles the price limit on (to `enableWithPrice`) or off (`null`) through this plan's queue. */
  toggleLimit: (
    enableWithPrice?: number,
  ) => Promise<CommitOutcome<TPlan, R, PlanPatch>>;
  /** Toggles `alertEnabled` through this plan's queue. */
  toggleAlert: () => Promise<CommitOutcome<TPlan, R, PlanPatch>>;
  /** Releases this view handle (e.g. when the drawer closes) without destroying the underlying provider queue. */
  dispose: () => void;
}

export interface PlanPatchControllerOptions<
  TPlan extends EditablePlanRecord = EditablePlanRecord,
  R = unknown,
> {
  initialPlans?: TPlan[];
  send: (
    planId: string,
    patch: PlanPatch,
    meta: { seq: number; isCurrent: () => boolean },
  ) => Promise<CommitAttemptResult<R>>;
  onPlansChange?: (plans: TPlan[]) => void;
  onSavingChange?: (savingById: Record<string, boolean>) => void;
  onPlanSuccess?: (
    planId: string,
    plan: TPlan,
    result: CommitAttemptResult<R>,
    patch: PlanPatch,
  ) => void;
  onPlanRollback?: (
    planId: string,
    confirmedPlan: TPlan,
    error: string,
    patch: PlanPatch,
  ) => void;
}

export interface PlanPatchController<
  TPlan extends EditablePlanRecord = EditablePlanRecord,
  R = unknown,
> {
  /** Returns the current provider-visible `plans` list (reflecting optimistic values while pending, server row on success, confirmed row on rollback). */
  getPlans: () => TPlan[];
  /** Returns a single provider-visible plan by id. */
  getPlan: (planId: string | number) => TPlan | undefined;
  /** Returns the last server-confirmed plan by id. */
  getConfirmedPlan: (planId: string | number) => TPlan | undefined;
  /** True when a PATCH is in flight or pending for `planId`. */
  isSaving: (planId: string | number) => boolean;
  /** Snapshot of per-plan `saving` flags. */
  getSavingMap: () => Record<string, boolean>;
  /** Enqueues a partial PATCH for `planId` through its per-plan queue. */
  patchPlan: (
    planId: string | number,
    patch: PlanPatch,
  ) => Promise<CommitOutcome<TPlan, R, PlanPatch>>;
  /** Records a live local edit (e.g. slider drag) for `planId`. */
  setLocalValue: (planId: string | number, patch: PlanPatch) => number;
  /** Acquires a per-plan view handle (used by drawer cards or tests). Dropping and re-acquiring reuses the same underlying queue. */
  getPlanHandle: (planId: string | number) => PlanHandle<TPlan, R>;
  /** Syncs the provider plans list from a server fetch without clobbering plans that have in-flight/pending edits. */
  syncPlans: (plans: TPlan[]) => void;
  /** Inserts or updates a single plan (e.g. after createPlan). */
  upsertPlan: (plan: TPlan) => void;
  /** Removes a plan and cleans up its commit queue (e.g. on deletePlan). */
  removePlan: (planId: string | number) => TPlan | undefined;
  /** Clears all plans and cleans up all per-plan commit queues (e.g. on signOut). */
  clear: () => void;
  /** Returns the number of active per-plan queues currently allocated. */
  getQueueCount: () => number;
}

function extractConfirmedPlan<TPlan extends EditablePlanRecord, R>(
  appliedConfirmed: TPlan,
  _patch: PlanPatch,
  result: CommitAttemptResult<R>,
): TPlan {
  const data = result.data;
  if (isPlainObject(data)) {
    if ("plan" in data && isPlainObject(data.plan)) {
      return { ...appliedConfirmed, ...(data.plan as Partial<TPlan>) };
    }
    const merged: TPlan = { ...appliedConfirmed };
    if ("alertEnabled" in data && typeof data.alertEnabled === "boolean") {
      merged.alertEnabled = data.alertEnabled;
    }
    if (
      "targetPrice" in data &&
      (typeof data.targetPrice === "number" || data.targetPrice === null)
    ) {
      merged.targetPrice = data.targetPrice;
    }
    return merged;
  }
  return appliedConfirmed;
}

/**
 * Provider-level controller that owns one lazy `PlanCommitQueue` per plan id for
 * the lifetime of `AccountProvider`, serializing and coalescing all partial plan
 * PATCHes (`alertEnabled`, `targetPrice` slider, limit on/off) and reconciling
 * provider `plans` state on stale successes and failures.
 */
export function createPlanPatchController<
  TPlan extends EditablePlanRecord = EditablePlanRecord,
  R = unknown,
>(
  options: PlanPatchControllerOptions<TPlan, R>,
): PlanPatchController<TPlan, R> {
  let plans: TPlan[] = options.initialPlans ? [...options.initialPlans] : [];
  let savingById: Record<string, boolean> = {};
  const queues = new Map<string, PlanCommitQueue<TPlan, R, PlanPatch>>();
  const lastNonNullTargetById = new Map<string, number>();

  for (const p of plans) {
    if (typeof p.targetPrice === "number") {
      lastNonNullTargetById.set(String(p.id), p.targetPrice);
    }
  }

  function notifyPlans(): void {
    options.onPlansChange?.([...plans]);
  }

  function notifySaving(): void {
    options.onSavingChange?.({ ...savingById });
  }

  function findPlan(key: string): TPlan | undefined {
    return plans.find((p) => String(p.id) === key);
  }

  function getOrCreateQueue(
    key: string,
    baselinePlan: TPlan,
  ): PlanCommitQueue<TPlan, R, PlanPatch> {
    let q = queues.get(key);
    if (!q) {
      q = createPlanCommitQueue<TPlan, R, PlanPatch>({
        initialValue: baselinePlan,
        send: (planId, patch, meta) => options.send(planId, patch, meta),
        resolveConfirmed: (appliedConfirmed, patch, res) =>
          extractConfirmedPlan(appliedConfirmed, patch, res),
        onStateChange: (planId, state) => {
          if (typeof state.value.targetPrice === "number") {
            lastNonNullTargetById.set(planId, state.value.targetPrice);
          }
          let changedPlan = false;
          plans = plans.map((p) => {
            if (String(p.id) !== planId) return p;
            changedPlan = true;
            return state.value;
          });
          if (changedPlan) {
            notifyPlans();
          }

          const prevSaving = Boolean(savingById[planId]);
          if (prevSaving !== state.saving) {
            savingById = { ...savingById, [planId]: state.saving };
            notifySaving();
          }
        },
        onSuccess: (planId, value, res, _seq, patch) => {
          options.onPlanSuccess?.(planId, value, res, patch);
        },
        onRollback: (planId, rollbackValue, error, _seq, patch) => {
          options.onPlanRollback?.(planId, rollbackValue, error, patch);
        },
      });
      queues.set(key, q);
    }
    return q;
  }

  const controller: PlanPatchController<TPlan, R> = {
    getPlans(): TPlan[] {
      return [...plans];
    },

    getPlan(planId: string | number): TPlan | undefined {
      return findPlan(String(planId));
    },

    getConfirmedPlan(planId: string | number): TPlan | undefined {
      const key = String(planId);
      const q = queues.get(key);
      if (q) {
        return q.getState(key, findPlan(key)).confirmedValue;
      }
      return findPlan(key);
    },

    isSaving(planId: string | number): boolean {
      const key = String(planId);
      return Boolean(savingById[key]);
    },

    getSavingMap(): Record<string, boolean> {
      return { ...savingById };
    },

    patchPlan(
      planId: string | number,
      patch: PlanPatch,
    ): Promise<CommitOutcome<TPlan, R, PlanPatch>> {
      const key = String(planId);
      const existing = findPlan(key);
      if (!existing) {
        const emptyFallback = {
          id: planId,
          alertEnabled: Boolean(patch.alertEnabled),
          targetPrice: patch.targetPrice ?? null,
        } as TPlan;
        return Promise.resolve({
          seq: 0,
          value: emptyFallback,
          patch,
          superseded: false,
          applied: false,
          rolledBack: false,
          currentValue: emptyFallback,
          confirmedValue: emptyFallback,
          error: "Plan not found.",
        });
      }
      if (typeof patch.targetPrice === "number") {
        lastNonNullTargetById.set(key, patch.targetPrice);
      }
      const q = getOrCreateQueue(key, existing);
      return q.commit(key, patch, existing);
    },

    setLocalValue(planId: string | number, patch: PlanPatch): number {
      const key = String(planId);
      const existing = findPlan(key);
      if (!existing) return 0;
      if (typeof patch.targetPrice === "number") {
        lastNonNullTargetById.set(key, patch.targetPrice);
      }
      const q = getOrCreateQueue(key, existing);
      return q.setLocalValue(key, patch, existing);
    },

    getPlanHandle(planId: string | number): PlanHandle<TPlan, R> {
      const key = String(planId);
      const existing = findPlan(key);
      if (existing) {
        getOrCreateQueue(key, existing);
      }
      let disposed = false;

      return {
        planId: key,
        getPlan: () => controller.getPlan(key),
        getConfirmedPlan: () => controller.getConfirmedPlan(key),
        getUiTargetPrice: () => controller.getPlan(key)?.targetPrice ?? null,
        isSaving: () => controller.isSaving(key),
        patch: (partial: PlanPatch) => controller.patchPlan(key, partial),
        setSliderDraft: (targetPrice: number) => {
          if (disposed) return 0;
          return controller.setLocalValue(key, { targetPrice });
        },
        commitSlider: (targetPrice: number) =>
          controller.patchPlan(key, { targetPrice }),
        toggleLimit: (enableWithPrice?: number) => {
          const current = controller.getPlan(key);
          const isCurrentlyEnabled =
            current !== undefined && current.targetPrice !== null;
          if (isCurrentlyEnabled) {
            return controller.patchPlan(key, { targetPrice: null });
          }
          const nextPrice =
            enableWithPrice ?? lastNonNullTargetById.get(key) ?? 10_000;
          return controller.patchPlan(key, { targetPrice: nextPrice });
        },
        toggleAlert: () => {
          const current = controller.getPlan(key);
          const nextAlert = !(current?.alertEnabled ?? false);
          return controller.patchPlan(key, { alertEnabled: nextAlert });
        },
        dispose: () => {
          disposed = true;
        },
      };
    },

    syncPlans(nextPlans: TPlan[]): void {
      plans = nextPlans.map((serverPlan) => {
        const key = String(serverPlan.id);
        if (typeof serverPlan.targetPrice === "number") {
          lastNonNullTargetById.set(key, serverPlan.targetPrice);
        }
        const q = queues.get(key);
        if (!q) return serverPlan;
        if (!q.isBusy(key)) {
          q.syncServerValue(key, serverPlan);
          return q.getState(key, serverPlan).value;
        }
        return q.getState(key, serverPlan).value;
      });
      notifyPlans();
    },

    upsertPlan(plan: TPlan): void {
      const key = String(plan.id);
      if (typeof plan.targetPrice === "number") {
        lastNonNullTargetById.set(key, plan.targetPrice);
      }
      const q = queues.get(key);
      if (q && !q.isBusy(key)) {
        q.syncServerValue(key, plan);
      }
      const exists = plans.some((p) => String(p.id) === key);
      if (exists) {
        plans = plans.map((p) => (String(p.id) === key ? plan : p));
      } else {
        plans = [plan, ...plans];
      }
      notifyPlans();
    },

    removePlan(planId: string | number): TPlan | undefined {
      const key = String(planId);
      const removed = findPlan(key);
      const q = queues.get(key);
      if (q) {
        q.remove(key);
        queues.delete(key);
      }
      lastNonNullTargetById.delete(key);
      if (key in savingById) {
        const nextSaving = { ...savingById };
        delete nextSaving[key];
        savingById = nextSaving;
        notifySaving();
      }
      plans = plans.filter((p) => String(p.id) !== key);
      notifyPlans();
      return removed;
    },

    clear(): void {
      for (const q of queues.values()) {
        q.clear();
      }
      queues.clear();
      lastNonNullTargetById.clear();
      plans = [];
      savingById = {};
      notifyPlans();
      notifySaving();
    },

    getQueueCount(): number {
      return queues.size;
    },
  };

  return controller;
}

