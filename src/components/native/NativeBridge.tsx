"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "../account/AccountProvider";
import { api } from "../account/api";
import { BellIcon, CloseIcon } from "../icons";
import type { Query } from "../recentStore";
import { safeSameOriginUrl } from "./safeUrl";

export { safeSameOriginUrl };

export const PUSH_TOKEN_STORAGE_KEY = "trippie.pushToken";
export const PUSH_PROMPTED_STORAGE_KEY = "trippie.pushPrompted";

/**
 * Parses deep-link search query parameters from a URL query string.
 */
export function parseDeepLinkQuery(search: string): Query | null {
  if (!search || search === "?") return null;
  const sp = new URLSearchParams(search);
  const origin = sp.get("origin");
  const destination = sp.get("destination");
  const month = sp.get("month");
  if (!origin || !destination || !month) return null;
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
  if (origin === destination) return null;
  if (!/^\d{4}-\d{2}$/.test(month)) return null;

  const trip = sp.get("trip") ?? "round";
  if (trip !== "round" && trip !== "oneway") return null;

  const cabin = sp.get("cabin") ?? "economy";
  if (cabin !== "economy" && cabin !== "business") return null;

  const rawMin = sp.get("minGap");
  const rawMax = sp.get("maxGap");

  if (trip === "oneway") {
    if (rawMin !== null && !/^-?\d+$/.test(rawMin)) return null;
    if (rawMax !== null && !/^-?\d+$/.test(rawMax)) return null;
    return {
      origin,
      destination,
      month,
      trip: "oneway",
      minGap: 0,
      maxGap: 0,
      cabin,
    };
  }

  if (rawMin === null || !/^-?\d+$/.test(rawMin)) return null;
  const minGap = Number(rawMin);
  const effectiveRawMax = rawMax ?? rawMin;
  if (!/^-?\d+$/.test(effectiveRawMax)) return null;
  const maxGap = Number(effectiveRawMax);
  if (
    !Number.isInteger(minGap) ||
    !Number.isInteger(maxGap) ||
    minGap < 1 ||
    maxGap > 30 ||
    minGap > maxGap
  ) {
    return null;
  }

  return {
    origin,
    destination,
    month,
    trip: "round",
    minGap,
    maxGap,
    cabin,
  };
}

export default function NativeBridge() {
  const {
    user,
    isNative,
    setIsNative,
    pushStatus,
    setPushStatus,
    pushPromptOpen,
    setPushPromptOpen,
    requestPushPermission,
    searchAgain,
  } = useAccount();

  const userRef = useRef(user);
  const searchAgainRef = useRef(searchAgain);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    searchAgainRef.current = searchAgain;
  }, [searchAgain]);

  // 1. Detect Capacitor native platform, set up push channel & listeners, external link interceptor, and back button
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) {
          return;
        }
      } catch {
        return;
      }

      if (disposed) return;
      setIsNative(true);

      // (d) Intercept clicks on external http(s) <a> links and open them in Custom Tabs
      const handleDocumentClick = (e: MouseEvent) => {
        if (e.defaultPrevented) return;
        if (!(e.target instanceof Element)) return;
        const anchor = e.target.closest("a[href]");
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const rawHref = anchor.getAttribute("href");
        if (!rawHref) return;

        let parsed: URL;
        try {
          parsed = new URL(rawHref, window.location.href);
        } catch {
          return;
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return;
        }
        if (parsed.origin === window.location.origin) {
          return;
        }

        e.preventDefault();
        const externalUrl = parsed.toString();
        void (async () => {
          try {
            const { Browser } = await import("@capacitor/browser");
            await Browser.open({ url: externalUrl });
          } catch {
            // Ignore browser open failure
          }
        })();
      };

      document.addEventListener("click", handleDocumentClick);
      cleanups.push(() => {
        document.removeEventListener("click", handleDocumentClick);
      });

      // (e) Android hardware back button via @capacitor/app
      try {
        const { App } = await import("@capacitor/app");
        const backHandle = await App.addListener("backButton", ({ canGoBack }) => {
          try {
            if (canGoBack) {
              window.history.back();
            } else {
              void App.minimizeApp().catch(() => undefined);
            }
          } catch {
            // Ignore back navigation error
          }
        });
        if (disposed) {
          void backHandle.remove().catch(() => undefined);
        } else {
          cleanups.push(() => {
            void backHandle.remove().catch(() => undefined);
          });
        }
      } catch {
        // Ignore @capacitor/app initialization failure
      }

      // (a) & (b) Push notifications channel, listeners, and initial permission check
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        await PushNotifications.createChannel({
          id: "price_alerts",
          name: "Price alerts",
          importance: 4,
        }).catch(() => undefined);

        const regHandle = await PushNotifications.addListener("registration", (token) => {
          const rawToken = token?.value;
          if (typeof rawToken !== "string" || !rawToken) return;
          try {
            window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, rawToken);
          } catch {
            // Ignore storage errors
          }
          if (userRef.current) {
            void api("/api/devices", {
              method: "POST",
              body: { token: rawToken, platform: "android" },
            });
          }
        });

        const errHandle = await PushNotifications.addListener("registrationError", () => {
          console.warn("Push notification registration failed");
        });

        const actionHandle = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (event) => {
            try {
              const rawUrl = (event?.notification?.data as { url?: unknown } | undefined)?.url;
              if (typeof rawUrl !== "string") return;
              const safeUrl = safeSameOriginUrl(rawUrl, window.location.origin);
              if (!safeUrl) return;

              const parsed = new URL(safeUrl);
              const deepQuery =
                parsed.pathname === "/" ? parseDeepLinkQuery(parsed.search) : null;
              if (deepQuery && window.location.pathname === "/") {
                window.history.replaceState(null, "", "/");
                searchAgainRef.current(deepQuery);
              } else {
                window.location.assign(safeUrl);
              }
            } catch {
              // Ignore malformed notification data
            }
          },
        );

        if (disposed) {
          void regHandle.remove().catch(() => undefined);
          void errHandle.remove().catch(() => undefined);
          void actionHandle.remove().catch(() => undefined);
          return;
        }

        cleanups.push(() => {
          void regHandle.remove().catch(() => undefined);
          void errHandle.remove().catch(() => undefined);
          void actionHandle.remove().catch(() => undefined);
        });

        const perm = await PushNotifications.checkPermissions();
        if (!disposed) {
          if (perm.receive === "granted") {
            setPushStatus("on");
          } else if (perm.receive === "denied") {
            setPushStatus("blocked");
          } else {
            setPushStatus("off");
          }
        }
      } catch {
        // Ignore push plugin setup failure
      }
    })();

    return () => {
      disposed = true;
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [setIsNative, setPushStatus]);

  // 2. When signed in on native, check permissions and register if already granted
  useEffect(() => {
    if (!isNative || !user) return;
    let cancelled = false;

    void (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const perm = await PushNotifications.checkPermissions();
        if (cancelled) return;

        if (perm.receive === "granted") {
          setPushStatus("on");
          await PushNotifications.register();
          const savedToken = window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
          if (savedToken && !cancelled) {
            await api("/api/devices", {
              method: "POST",
              body: { token: savedToken, platform: "android" },
            });
          }
        } else if (perm.receive === "denied") {
          setPushStatus("blocked");
        } else {
          setPushStatus("off");
        }
      } catch {
        // Ignore check/register failure
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isNative, user, setPushStatus]);

  if (!isNative || !pushPromptOpen || pushStatus !== "off") {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-results"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setPushPromptOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enable phone notifications"
        className="glass-strong relative w-full max-w-sm p-5 sm:p-6 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <BellIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-semibold tracking-tight text-[var(--text-primary)]">
                Turn on phone notifications?
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Get instant push alerts on your phone when fares drop for your saved plans.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPushPromptOpen(false)}
            aria-label="Dismiss notification prompt"
            className="glass-field focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={async () => {
              setPushPromptOpen(false);
              await requestPushPermission();
            }}
            className="btn-accent focus-ring inline-flex min-h-[40px] flex-1 items-center justify-center rounded-full px-4 py-2 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            Enable phone notifications
          </button>
          <button
            type="button"
            onClick={() => setPushPromptOpen(false)}
            className="glass-field focus-ring inline-flex min-h-[40px] items-center justify-center rounded-full px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
