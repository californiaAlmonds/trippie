export interface CommitAttemptResult<R = unknown> {
  ok: boolean;
  data?: R | null;
  error?: string | null;
}

export interface CommitOutcome<T, R = unknown> {
  /** Sequence number assigned to this commit. */
  seq: number;
  /** The value requested for this commit. */
  value: T;
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

export interface PlanCommitQueueOptions<T, R = unknown> {
  /** Default confirmed value for a plan before its first commit. */
  initialValue?: T;
  /** Executes the network PATCH for `(planId, value)`. */
  send: (
    planId: string,
    value: T,
    meta: { seq: number; isCurrent: () => boolean },
  ) => Promise<CommitAttemptResult<R>>;
  /** Notified whenever a plan's value, confirmedValue, or saving flag changes. */
  onStateChange?: (planId: string, state: PlanQueueState<T>) => void;
  /** Notified when a non-stale commit succeeds and no newer local value exists. */
  onSuccess?: (
    planId: string,
    value: T,
    result: CommitAttemptResult<R>,
    seq: number,
  ) => void;
  /** Notified when a non-stale commit fails and no newer local value exists, rolling back to `confirmedValue`. */
  onRollback?: (
    planId: string,
    rollbackValue: T,
    error: string,
    seq: number,
  ) => void;
}

interface PendingTask<T, R> {
  value: T;
  seq: number;
  resolve: (outcome: CommitOutcome<T, R>) => void;
}

interface PlanQueueEntry<T, R> {
  currentValue: T;
  confirmedValue: T;
  latestSeq: number;
  resetGen: number;
  inFlight: boolean;
  pending: PendingTask<T, R> | null;
}

export interface PlanCommitQueue<T, R = unknown> {
  /** Enqueues a commit for `planId`. At most one request is in flight per plan; newer commits coalesce into a single pending slot. */
  commit: (
    planId: string,
    value: T,
    baselineValue?: T,
  ) => Promise<CommitOutcome<T, R>>;
  /** Records a live local edit (e.g. slider drag before release) so any in-flight request is marked stale and cannot overwrite or roll back over it. */
  setLocalValue: (planId: string, value: T, baselineValue?: T) => number;
  /** Syncs the server-confirmed value when no commit is in flight or pending for `planId`. */
  syncServerValue: (planId: string, confirmedValue: T) => void;
  /** Cancels any pending commit and invalidates any in-flight request for `planId`, resetting to `confirmedValue`. */
  cancel: (planId: string, confirmedValue: T) => void;
  /** True when a commit is currently in flight or queued for `planId`. */
  isBusy: (planId: string) => boolean;
  /** True when `seq` is still the latest sequence number for `planId` and no pending commit is waiting. */
  isCurrentSeq: (planId: string, seq: number) => boolean;
  /** Returns a snapshot of the current queue state for `planId`. */
  getState: (planId: string, fallbackValue?: T) => PlanQueueState<T>;
}

/**
 * Creates a pure per-plan commit queue/coalescer:
 * - Serializes commits per plan id (at most one PATCH in flight).
 * - Coalesces rapid commits while one is in flight (keeps only the latest pending value and sends it after the current request settles).
 * - Tracks sequence numbers so stale responses are ignored and never overwrite newer state.
 * - Rolls back to the last confirmed value on failure only when no newer local value exists.
 */
export function createPlanCommitQueue<T = number, R = unknown>(
  options: PlanCommitQueueOptions<T, R>,
): PlanCommitQueue<T, R> {
  const entries = new Map<string, PlanQueueEntry<T, R>>();

  function ensureEntry(planId: string, baselineValue?: T): PlanQueueEntry<T, R> {
    const key = String(planId);
    let entry = entries.get(key);
    if (!entry) {
      const init = (baselineValue !== undefined ? baselineValue : options.initialValue) as T;
      entry = {
        currentValue: init,
        confirmedValue: init,
        latestSeq: 0,
        resetGen: 0,
        inFlight: false,
        pending: null,
      };
      entries.set(key, entry);
    }
    return entry;
  }

  function emitState(planId: string, entry: PlanQueueEntry<T, R>): void {
    options.onStateChange?.(String(planId), {
      value: entry.currentValue,
      confirmedValue: entry.confirmedValue,
      saving: entry.inFlight || entry.pending !== null,
      seq: entry.latestSeq,
    });
  }

  function isEntryCurrent(entry: PlanQueueEntry<T, R>, seq: number, gen: number): boolean {
    return entry.resetGen === gen && entry.latestSeq === seq && entry.pending === null;
  }

  async function runLoop(
    planId: string,
    entry: PlanQueueEntry<T, R>,
    initialTask: PendingTask<T, R>,
  ): Promise<void> {
    const key = String(planId);
    entry.inFlight = true;
    emitState(key, entry);

    let task: PendingTask<T, R> | null = initialTask;
    while (task) {
      const { value, seq, resolve } = task;
      const startGen = entry.resetGen;
      const isCurrent = () => isEntryCurrent(entry, seq, startGen);

      let res: CommitAttemptResult<R>;
      try {
        res = await options.send(key, value, { seq, isCurrent });
      } catch (err) {
        res = {
          ok: false,
          error: err instanceof Error ? err.message : "Could not update target price.",
        };
      }

      if (entry.resetGen !== startGen) {
        resolve({
          seq,
          value,
          superseded: true,
          applied: false,
          rolledBack: false,
          currentValue: entry.currentValue,
          confirmedValue: entry.confirmedValue,
          result: res,
        });
        break;
      }

      const stillCurrent = isCurrent();
      if (res.ok) {
        entry.confirmedValue = value;
        if (stillCurrent) {
          entry.currentValue = value;
          options.onSuccess?.(key, value, res, seq);
          resolve({
            seq,
            value,
            superseded: false,
            applied: true,
            rolledBack: false,
            currentValue: entry.currentValue,
            confirmedValue: entry.confirmedValue,
            result: res,
          });
        } else {
          resolve({
            seq,
            value,
            superseded: true,
            applied: false,
            rolledBack: false,
            currentValue: entry.currentValue,
            confirmedValue: entry.confirmedValue,
            result: res,
          });
        }
      } else if (stillCurrent) {
        entry.currentValue = entry.confirmedValue;
        const errMsg = res.error ?? "Could not update target price.";
        options.onRollback?.(key, entry.confirmedValue, errMsg, seq);
        resolve({
          seq,
          value,
          superseded: false,
          applied: false,
          rolledBack: true,
          currentValue: entry.currentValue,
          confirmedValue: entry.confirmedValue,
          error: errMsg,
          result: res,
        });
      } else {
        resolve({
          seq,
          value,
          superseded: true,
          applied: false,
          rolledBack: false,
          currentValue: entry.currentValue,
          confirmedValue: entry.confirmedValue,
          result: res,
        });
      }

      if (entry.pending) {
        task = entry.pending;
        entry.pending = null;
      } else {
        task = null;
      }
    }

    entry.inFlight = false;
    emitState(key, entry);
  }

  return {
    commit(planId: string, value: T, baselineValue?: T): Promise<CommitOutcome<T, R>> {
      const key = String(planId);
      const entry = ensureEntry(key, baselineValue ?? value);

      if (!entry.inFlight && entry.pending === null && Object.is(value, entry.confirmedValue)) {
        entry.currentValue = value;
        return Promise.resolve({
          seq: entry.latestSeq,
          value,
          superseded: false,
          applied: false,
          rolledBack: false,
          currentValue: entry.currentValue,
          confirmedValue: entry.confirmedValue,
        });
      }

      const seq = ++entry.latestSeq;
      entry.currentValue = value;

      return new Promise<CommitOutcome<T, R>>((resolve) => {
        const nextTask: PendingTask<T, R> = { value, seq, resolve };
        if (entry.inFlight) {
          if (entry.pending) {
            const prevPending = entry.pending;
            prevPending.resolve({
              seq: prevPending.seq,
              value: prevPending.value,
              superseded: true,
              applied: false,
              rolledBack: false,
              currentValue: entry.currentValue,
              confirmedValue: entry.confirmedValue,
            });
          }
          entry.pending = nextTask;
          emitState(key, entry);
          return;
        }

        void runLoop(key, entry, nextTask);
      });
    },

    setLocalValue(planId: string, value: T, baselineValue?: T): number {
      const key = String(planId);
      const entry = ensureEntry(key, baselineValue ?? value);
      entry.currentValue = value;
      entry.latestSeq++;
      emitState(key, entry);
      return entry.latestSeq;
    },

    syncServerValue(planId: string, confirmedValue: T): void {
      const key = String(planId);
      const entry = ensureEntry(key, confirmedValue);
      if (entry.inFlight || entry.pending !== null) return;
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
      if (entry.pending) {
        const prevPending = entry.pending;
        entry.pending = null;
        prevPending.resolve({
          seq: prevPending.seq,
          value: prevPending.value,
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

    isBusy(planId: string): boolean {
      const entry = entries.get(String(planId));
      return Boolean(entry && (entry.inFlight || entry.pending !== null));
    },

    isCurrentSeq(planId: string, seq: number): boolean {
      const entry = entries.get(String(planId));
      if (!entry) return false;
      return entry.latestSeq === seq && entry.pending === null;
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
