"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TripMode } from "@/lib/search";
import type { Query } from "../recentStore";
import {
  type AccountUser,
  type ApiResult,
  api,
  isEndpointUnavailable,
  type Plan,
} from "./api";

export type AccountStatus = "loading" | "authenticated" | "guest";

export interface CreatePlanInput {
  origin: string;
  destination: string;
  month: string;
  trip: TripMode;
  minGap?: number;
  maxGap?: number;
  alertEnabled?: boolean;
  targetPrice?: number | null;
}

export interface OpenAuthDialogOptions {
  tab?: "signin" | "signup";
  onSuccess?: (user: AccountUser) => void | Promise<void>;
}

export interface AccountContextValue {
  user: AccountUser | null;
  status: AccountStatus;
  refresh: () => Promise<AccountUser | null>;
  signIn: (
    email: string,
    password: string,
  ) => Promise<ApiResult<{ user: AccountUser }>>;
  signUp: (
    email: string,
    password: string,
  ) => Promise<ApiResult<{ user: AccountUser }>>;
  signOut: () => Promise<void>;
  deleteAccount: (password: string) => Promise<ApiResult<null>>;
  authDialogOpen: boolean;
  authDialogTab: "signin" | "signup";
  openAuthDialog: (options?: OpenAuthDialogOptions) => void;
  closeAuthDialog: () => void;
  plansOpen: boolean;
  openPlans: () => void;
  closePlans: () => void;
  plans: Plan[];
  plansLoading: boolean;
  refreshPlans: () => Promise<void>;
  createPlan: (input: CreatePlanInput) => Promise<ApiResult<{ plan: Plan }>>;
  updatePlan: (
    id: string | number,
    patch: { alertEnabled?: boolean; targetPrice?: number | null },
  ) => Promise<ApiResult<{ plan: Plan }>>;
  deletePlan: (id: string | number) => Promise<ApiResult<null>>;
  searchAgain: (q: Query) => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({
  children,
  onSearchAgain,
}: {
  children: ReactNode;
  onSearchAgain?: (q: Query) => void;
}) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [status, setStatus] = useState<AccountStatus>("loading");

  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogTab, setAuthDialogTab] = useState<"signin" | "signup">(
    "signin",
  );
  const pendingSuccessRef = useRef<
    ((u: AccountUser) => void | Promise<void>) | null
  >(null);

  const [plansOpen, setPlansOpen] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const refresh = useCallback(async (): Promise<AccountUser | null> => {
    const res = await api<{ user: AccountUser | null }>("/api/auth/me");
    if (res.ok && res.data?.user) {
      setUser(res.data.user);
      setStatus("authenticated");
      return res.data.user;
    }
    setUser(null);
    setStatus("guest");
    return null;
  }, []);

  const refreshPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await api<{ plans: Plan[] }>("/api/plans");
      if (res.ok && Array.isArray(res.data?.plans)) {
        setPlans(res.data.plans);
      } else if (isEndpointUnavailable(res)) {
        // Parallel backend route not mounted yet; keep existing session fallback
      }
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api<{ user: AccountUser | null }>("/api/auth/me").then((res) => {
      if (cancelled) return;
      if (res.ok && res.data?.user) {
        setUser(res.data.user);
        setStatus("authenticated");
        void api<{ plans: Plan[] }>("/api/plans").then((plansRes) => {
          if (cancelled) return;
          if (plansRes.ok && Array.isArray(plansRes.data?.plans)) {
            setPlans(plansRes.data.plans);
          }
        });
      } else {
        setUser(null);
        setStatus("guest");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runPendingAuthSuccess = useCallback(async (authedUser: AccountUser) => {
    const cb = pendingSuccessRef.current;
    pendingSuccessRef.current = null;
    if (cb) {
      await cb(authedUser);
    }
  }, []);

  const signIn = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<ApiResult<{ user: AccountUser }>> => {
      const res = await api<{ user: AccountUser }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (res.ok && res.data?.user) {
        setUser(res.data.user);
        setStatus("authenticated");
        setAuthDialogOpen(false);
        void refreshPlans();
        await runPendingAuthSuccess(res.data.user);
      }
      return res;
    },
    [refreshPlans, runPendingAuthSuccess],
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<ApiResult<{ user: AccountUser }>> => {
      const res = await api<{ user: AccountUser }>("/api/auth/signup", {
        method: "POST",
        body: { email, password },
      });
      if (res.ok && res.data?.user) {
        setUser(res.data.user);
        setStatus("authenticated");
        setAuthDialogOpen(false);
        void refreshPlans();
        await runPendingAuthSuccess(res.data.user);
      }
      return res;
    },
    [refreshPlans, runPendingAuthSuccess],
  );

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setStatus("guest");
    setPlans([]);
    setPlansOpen(false);
  }, []);

  const deleteAccount = useCallback(
    async (password: string): Promise<ApiResult<null>> => {
      const res = await api<null>("/api/auth/me", {
        method: "DELETE",
        body: { password },
      });
      if (res.ok) {
        setUser(null);
        setStatus("guest");
        setPlans([]);
        setPlansOpen(false);
      }
      return res;
    },
    [],
  );

  const openAuthDialog = useCallback((options?: OpenAuthDialogOptions) => {
    setAuthDialogTab(options?.tab ?? "signin");
    pendingSuccessRef.current = options?.onSuccess ?? null;
    setAuthDialogOpen(true);
  }, []);

  const closeAuthDialog = useCallback(() => {
    pendingSuccessRef.current = null;
    setAuthDialogOpen(false);
  }, []);

  const openPlans = useCallback(() => {
    setPlansOpen(true);
    if (user) {
      void refreshPlans();
    }
  }, [user, refreshPlans]);

  const closePlans = useCallback(() => {
    setPlansOpen(false);
  }, []);

  const createPlan = useCallback(
    async (input: CreatePlanInput): Promise<ApiResult<{ plan: Plan }>> => {
      const payload: Record<string, unknown> = {
        origin: input.origin,
        destination: input.destination,
        month: input.month,
        trip: input.trip,
        alertEnabled: Boolean(input.alertEnabled),
        targetPrice: input.targetPrice ?? null,
      };
      if (input.trip === "round") {
        payload.minGap = input.minGap ?? 5;
        payload.maxGap = input.maxGap ?? 7;
      }

      const res = await api<{ plan: Plan }>("/api/plans", {
        method: "POST",
        body: payload,
      });

      if (res.ok && res.data?.plan) {
        const created = res.data.plan;
        setPlans((prev) => [
          created,
          ...prev.filter((p) => String(p.id) !== String(created.id)),
        ]);
        return res;
      }

      if (isEndpointUnavailable(res)) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const fallbackPlan: Plan = {
          id: `local-${Date.now()}`,
          origin: input.origin,
          destination: input.destination,
          month: input.month,
          trip: input.trip,
          minGap: input.trip === "round" ? (input.minGap ?? 5) : 0,
          maxGap: input.trip === "round" ? (input.maxGap ?? 7) : 0,
          alertEnabled: Boolean(input.alertEnabled && user?.verified),
          targetPrice: input.targetPrice ?? null,
          lastAlertPrice: null,
          expired: input.month < currentMonth,
          createdAt: new Date().toISOString(),
        };
        setPlans((prev) => [fallbackPlan, ...prev].slice(0, 20));
        return { ok: true, status: 201, data: { plan: fallbackPlan } };
      }

      return res;
    },
    [user?.verified],
  );

  const updatePlan = useCallback(
    async (
      id: string | number,
      patch: { alertEnabled?: boolean; targetPrice?: number | null },
    ): Promise<ApiResult<{ plan: Plan }>> => {
      let snapshot: Plan[] = [];
      let optimisticPlan: Plan | null = null;

      setPlans((prev) => {
        snapshot = prev;
        return prev.map((p) => {
          if (String(p.id) !== String(id)) return p;
          const next: Plan = {
            ...p,
            ...(patch.alertEnabled !== undefined
              ? { alertEnabled: patch.alertEnabled }
              : {}),
            ...(patch.targetPrice !== undefined
              ? { targetPrice: patch.targetPrice }
              : {}),
          };
          optimisticPlan = next;
          return next;
        });
      });

      const res = await api<{ plan: Plan }>(
        `/api/plans/${encodeURIComponent(String(id))}`,
        {
          method: "PATCH",
          body: patch,
        },
      );

      if (res.ok && res.data?.plan) {
        const updated = res.data.plan;
        setPlans((prev) =>
          prev.map((p) => (String(p.id) === String(id) ? updated : p)),
        );
        return res;
      }

      if (isEndpointUnavailable(res) && optimisticPlan) {
        return { ok: true, status: 200, data: { plan: optimisticPlan } };
      }

      setPlans(snapshot);
      return res;
    },
    [],
  );

  const deletePlan = useCallback(
    async (id: string | number): Promise<ApiResult<null>> => {
      let snapshot: Plan[] = [];
      setPlans((prev) => {
        snapshot = prev;
        return prev.filter((p) => String(p.id) !== String(id));
      });

      const res = await api<null>(
        `/api/plans/${encodeURIComponent(String(id))}`,
        {
          method: "DELETE",
        },
      );

      if (res.ok || isEndpointUnavailable(res)) {
        return { ok: true, status: 204, data: null };
      }

      setPlans(snapshot);
      return res;
    },
    [],
  );

  const searchAgain = useCallback(
    (q: Query) => {
      setPlansOpen(false);
      onSearchAgain?.(q);
    },
    [onSearchAgain],
  );

  const visiblePlans = useMemo(() => (user ? plans : []), [user, plans]);

  const value = useMemo<AccountContextValue>(
    () => ({
      user,
      status,
      refresh,
      signIn,
      signUp,
      signOut,
      deleteAccount,
      authDialogOpen,
      authDialogTab,
      openAuthDialog,
      closeAuthDialog,
      plansOpen,
      openPlans,
      closePlans,
      plans: visiblePlans,
      plansLoading,
      refreshPlans,
      createPlan,
      updatePlan,
      deletePlan,
      searchAgain,
    }),
    [
      user,
      status,
      refresh,
      signIn,
      signUp,
      signOut,
      deleteAccount,
      authDialogOpen,
      authDialogTab,
      openAuthDialog,
      closeAuthDialog,
      plansOpen,
      openPlans,
      closePlans,
      visiblePlans,
      plansLoading,
      refreshPlans,
      createPlan,
      updatePlan,
      deletePlan,
      searchAgain,
    ],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

const FALLBACK_ACCOUNT_CONTEXT: AccountContextValue = {
  user: null,
  status: "guest",
  refresh: async () => null,
  signIn: async () => ({ ok: false, status: 0, data: null, error: "Unavailable" }),
  signUp: async () => ({ ok: false, status: 0, data: null, error: "Unavailable" }),
  signOut: async () => undefined,
  deleteAccount: async () => ({ ok: false, status: 0, data: null, error: "Unavailable" }),
  authDialogOpen: false,
  authDialogTab: "signin",
  openAuthDialog: () => undefined,
  closeAuthDialog: () => undefined,
  plansOpen: false,
  openPlans: () => undefined,
  closePlans: () => undefined,
  plans: [],
  plansLoading: false,
  refreshPlans: async () => undefined,
  createPlan: async () => ({ ok: false, status: 0, data: null, error: "Unavailable" }),
  updatePlan: async () => ({ ok: false, status: 0, data: null, error: "Unavailable" }),
  deletePlan: async () => ({ ok: false, status: 0, data: null, error: "Unavailable" }),
  searchAgain: () => undefined,
};

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  return ctx ?? FALLBACK_ACCOUNT_CONTEXT;
}
