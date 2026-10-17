"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "./account/AccountProvider";
import DeleteAccountDialog from "./account/DeleteAccountDialog";
import { BellIcon, BookmarkIcon, LogOutIcon, TrashIcon, UserIcon } from "./icons";

export default function AccountSlot() {
  const {
    user,
    status,
    openAuthDialog,
    openPlans,
    signOut,
    plans,
    isNative,
    pushStatus,
    requestPushPermission,
  } = useAccount();

  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  if (status === "loading") {
    return (
      <div
        aria-hidden="true"
        className="skeleton-shimmer h-9 w-20 rounded-full"
      />
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => openAuthDialog({ tab: "signin" })}
        className="glass-field focus-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-1.5 text-xs sm:text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
      >
        <UserIcon className="h-4 w-4 text-[var(--accent)]" />
        <span>Sign in</span>
      </button>
    );
  }

  const initial = (user.email.trim()[0] ?? "U").toUpperCase();
  const pushStatusLabel =
    pushStatus === "on" ? "On" : pushStatus === "blocked" ? "Blocked" : "Off";

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Account menu (${user.email})`}
        className="glass-field focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-full p-1.5 pr-3 text-xs font-medium text-[var(--text-primary)] cursor-pointer"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 via-[#0a84ff] to-indigo-600 text-xs font-bold text-white shadow-xs"
        >
          {initial}
        </span>
        <span className="hidden max-w-[140px] truncate sm:inline">
          {user.email}
        </span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Account options"
          className="glass-strong absolute right-0 top-full z-40 mt-2 w-64 p-2 animate-results"
        >
          <div className="border-b border-[var(--glass-border-subtle)] px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Signed in as
            </p>
            <p
              title={user.email}
              className="mt-0.5 truncate text-xs font-semibold text-[var(--text-primary)]"
            >
              {user.email}
            </p>
          </div>

          <div className="mt-1 grid gap-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                openPlans();
              }}
              className="focus-ring flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs sm:text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--glass-bg-subtle-hover)] cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <BookmarkIcon className="h-4 w-4 text-[var(--accent)]" />
                <span>Saved plans</span>
              </span>
              {plans.length > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--accent)]">
                  {plans.length}
                </span>
              )}
            </button>

            {isNative && (
              <div className="grid gap-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    if (pushStatus === "off") {
                      await requestPushPermission();
                    }
                  }}
                  className={`focus-ring flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs sm:text-sm font-medium text-[var(--text-primary)] ${
                    pushStatus === "off"
                      ? "hover:bg-[var(--glass-bg-subtle-hover)] cursor-pointer"
                      : "cursor-default"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <BellIcon className="h-4 w-4 text-[var(--accent)]" />
                    <span>Phone notifications</span>
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      pushStatus === "on"
                        ? "bg-[var(--badge-lowest-bg)] text-[var(--badge-lowest-text)]"
                        : pushStatus === "blocked"
                          ? "bg-[var(--delta-amber-bg)] text-[var(--delta-amber-text)]"
                          : "bg-slate-500/15 text-[var(--text-secondary)]"
                    }`}
                  >
                    {pushStatusLabel}
                  </span>
                </button>
                {pushStatus === "blocked" && (
                  <p className="px-3 pb-1 text-[11px] leading-snug text-[var(--text-muted)]">
                    Permission denied. To enable, open Android Settings → Apps → Trippie → Notifications.
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setMenuOpen(false);
                await signOut();
              }}
              className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs sm:text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--glass-bg-subtle-hover)] cursor-pointer"
            >
              <LogOutIcon className="h-4 w-4 text-[var(--text-muted)]" />
              <span>Sign out</span>
            </button>

            <div className="my-1 border-t border-[var(--glass-border-subtle)]" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
              className="focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs sm:text-sm font-medium text-[var(--delta-red-text)] hover:bg-red-500/10 cursor-pointer"
            >
              <TrashIcon className="h-4 w-4" />
              <span>Delete account</span>
            </button>
          </div>
        </div>
      )}

      {deleteOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <DeleteAccountDialog
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}
