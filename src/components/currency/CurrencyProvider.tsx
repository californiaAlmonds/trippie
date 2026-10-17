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
import { useAccount } from "../account/AccountProvider";
import { api } from "../account/api";
import { CheckIcon, CloseIcon } from "../icons";

export interface CurrencyMeta {
  code: string;
  symbol: string;
  name: string;
  decimals: number;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyMeta[] = [
  { code: "INR", symbol: "₹", name: "Indian Rupee", decimals: 0 },
  { code: "USD", symbol: "$", name: "US Dollar", decimals: 0 },
  { code: "EUR", symbol: "€", name: "Euro", decimals: 0 },
  { code: "GBP", symbol: "£", name: "British Pound", decimals: 0 },
  { code: "AED", symbol: "AED", name: "UAE Dirham", decimals: 0 },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", decimals: 0 },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", decimals: 0 },
  { code: "CAD", symbol: "CA$", name: "Canadian Dollar", decimals: 0 },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", decimals: 0 },
  { code: "THB", symbol: "฿", name: "Thai Baht", decimals: 0 },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", decimals: 0 },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", decimals: 0 },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar", decimals: 0 },
  { code: "CHF", symbol: "CHF", name: "Swiss Franc", decimals: 0 },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", decimals: 0 },
  { code: "SAR", symbol: "SAR", name: "Saudi Riyal", decimals: 0 },
  { code: "QAR", symbol: "QAR", name: "Qatari Riyal", decimals: 0 },
  { code: "KRW", symbol: "₩", name: "South Korean Won", decimals: 0 },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", decimals: 0 },
  { code: "ZAR", symbol: "R", name: "South African Rand", decimals: 0 },
  { code: "BRL", symbol: "R$", name: "Brazilian Real", decimals: 0 },
  { code: "SEK", symbol: "kr", name: "Swedish Krona", decimals: 0 },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone", decimals: 0 },
  { code: "DKK", symbol: "kr", name: "Danish Krone", decimals: 0 },
  { code: "PLN", symbol: "zł", name: "Polish Zloty", decimals: 0 },
  { code: "TRY", symbol: "₺", name: "Turkish Lira", decimals: 0 },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso", decimals: 0 },
  { code: "PHP", symbol: "₱", name: "Philippine Peso", decimals: 0 },
  { code: "VND", symbol: "₫", name: "Vietnamese Dong", decimals: 0 },
  { code: "LKR", symbol: "Rs", name: "Sri Lankan Rupee", decimals: 0 },
  { code: "NPR", symbol: "Rs", name: "Nepalese Rupee", decimals: 0 },
  { code: "BDT", symbol: "৳", name: "Bangladeshi Taka", decimals: 0 },
] as const;

export interface RatesAttribution {
  text: string;
  url: string;
}

export interface RatesPayload {
  base: string;
  date: string;
  rates: Record<string, number>;
  attribution?: RatesAttribution | null;
}

export interface CurrencyContextValue {
  currency: string;
  setCurrency: (next: string) => void;
  format: (inrAmount: number) => string;
  convert: (inrAmount: number) => number;
  toInr: (amountInCurrency: number) => number;
  ready: boolean;
  symbol: string;
  ratesDate: string | null;
  attribution: RatesAttribution | null;
  availableCurrencies: CurrencyMeta[];
}

const CURRENCY_STORAGE_KEY = "trippie.currency";

let sessionRatesCache: RatesPayload | null = null;
let sessionGeoCache: { country: string | null; currency: string } | null = null;

export function getCurrencySymbol(code: string): string {
  const known = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  if (known) return known.symbol;
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

export function getCurrencyName(code: string): string {
  const known = SUPPORTED_CURRENCIES.find((c) => c.code === code);
  if (known) return known.name;
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "currency" });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

const FALLBACK_INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const FALLBACK_CONTEXT: CurrencyContextValue = {
  currency: "INR",
  setCurrency: () => undefined,
  format: (inrAmount: number) => FALLBACK_INR_FORMATTER.format(Math.round(inrAmount)),
  convert: (inrAmount: number) => inrAmount,
  toInr: (amount: number) => Math.round(amount),
  ready: true,
  symbol: "₹",
  ratesDate: null,
  attribution: null,
  availableCurrencies: [...SUPPORTED_CURRENCIES],
};

const CurrencyContext = createContext<CurrencyContextValue>(FALLBACK_CONTEXT);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user } = useAccount();
  const [currency, setCurrencyState] = useState<string>("INR");
  const [ratesData, setRatesData] = useState<RatesPayload | null>(sessionRatesCache);
  const [ready, setReady] = useState<boolean>(false);
  const userInteractedRef = useRef(false);

  // 1. Load initial currency from localStorage, /api/rates, and /api/geo once
  useEffect(() => {
    let cancelled = false;

    let stored: string | null = null;
    try {
      const raw = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
      if (raw && /^[A-Z]{3}$/.test(raw.toUpperCase())) {
        stored = raw.toUpperCase();
      }
    } catch {
      // Ignore localStorage failures
    }

    void (async () => {
      const ratesPromise = sessionRatesCache
        ? Promise.resolve(sessionRatesCache)
        : api<RatesPayload>("/api/rates").then((res) => {
            if (res.ok && res.data && typeof res.data.rates === "object" && res.data.rates !== null) {
              const normalized: RatesPayload = {
                base: res.data.base ?? "INR",
                date: typeof res.data.date === "string" ? res.data.date : "",
                rates: { INR: 1, ...res.data.rates },
                attribution: res.data.attribution ?? null,
              };
              sessionRatesCache = normalized;
              return normalized;
            }
            return null;
          });

      const geoPromise = stored
        ? Promise.resolve(null)
        : sessionGeoCache
          ? Promise.resolve(sessionGeoCache)
          : api<{ country?: string | null; currency?: string }>("/api/geo").then((res) => {
              if (res.ok && typeof res.data?.currency === "string" && /^[A-Z]{3}$/.test(res.data.currency.toUpperCase())) {
                const geo = {
                  country: res.data.country ?? null,
                  currency: res.data.currency.toUpperCase(),
                };
                sessionGeoCache = geo;
                return geo;
              }
              return null;
            });

      const [loadedRates, loadedGeo] = await Promise.all([ratesPromise, geoPromise]);
      if (cancelled) return;

      if (loadedRates) {
        setRatesData(loadedRates);
      }

      if (!userInteractedRef.current) {
        const targetCur = stored ?? loadedGeo?.currency ?? "INR";
        const canConvert =
          targetCur === "INR" ||
          Boolean(loadedRates?.rates?.[targetCur] && loadedRates.rates[targetCur] > 0);
        const effectiveCur = canConvert ? targetCur : "INR";
        setCurrencyState(effectiveCur);
        if (loadedGeo?.currency && !stored) {
          try {
            window.localStorage.setItem(CURRENCY_STORAGE_KEY, effectiveCur);
          } catch {
            // Ignore storage errors
          }
        }
      }

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Sync with /api/prefs on sign-in
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void api<{ currency?: string | null }>("/api/prefs").then((res) => {
      if (cancelled) return;
      if (res.ok && typeof res.data?.currency === "string") {
        const prefCur = res.data.currency.toUpperCase();
        if (/^[A-Z]{3}$/.test(prefCur)) {
          const hasRate =
            prefCur === "INR" ||
            Boolean(
              (ratesData ?? sessionRatesCache)?.rates?.[prefCur] &&
                (ratesData ?? sessionRatesCache)!.rates[prefCur] > 0,
            );
          if (hasRate) {
            setCurrencyState(prefCur);
            try {
              window.localStorage.setItem(CURRENCY_STORAGE_KEY, prefCur);
            } catch {
              // Ignore storage errors
            }
          }
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [user, ratesData]);

  const setCurrency = useCallback(
    (nextRaw: string) => {
      const next = nextRaw.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(next)) return;
      userInteractedRef.current = true;
      setCurrencyState(next);
      try {
        window.localStorage.setItem(CURRENCY_STORAGE_KEY, next);
      } catch {
        // Ignore storage errors
      }
      if (user) {
        void api("/api/prefs", { method: "PUT", body: { currency: next } });
      }
    },
    [user],
  );

  const activeRate = useMemo(() => {
    if (currency === "INR") return 1;
    const r = ratesData?.rates?.[currency];
    return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
  }, [currency, ratesData]);

  const effectiveCurrency = useMemo(() => {
    if (currency === "INR") return "INR";
    const r = ratesData?.rates?.[currency];
    return typeof r === "number" && Number.isFinite(r) && r > 0 ? currency : "INR";
  }, [currency, ratesData]);

  const convert = useCallback(
    (inrAmount: number): number => {
      if (!Number.isFinite(inrAmount)) return 0;
      if (effectiveCurrency === "INR") return inrAmount;
      return inrAmount * activeRate;
    },
    [effectiveCurrency, activeRate],
  );

  const toInr = useCallback(
    (amountInCurrency: number): number => {
      if (!Number.isFinite(amountInCurrency)) return 0;
      if (effectiveCurrency === "INR" || activeRate <= 0) {
        return Math.round(amountInCurrency);
      }
      return Math.round(amountInCurrency / activeRate);
    },
    [effectiveCurrency, activeRate],
  );

  const formatter = useMemo(() => {
    if (effectiveCurrency === "INR") return FALLBACK_INR_FORMATTER;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: effectiveCurrency,
        maximumFractionDigits: 0,
      });
    } catch {
      return FALLBACK_INR_FORMATTER;
    }
  }, [effectiveCurrency]);

  const format = useCallback(
    (inrAmount: number): string => {
      const converted = convert(inrAmount);
      const formatted = formatter.format(Math.round(converted));
      return effectiveCurrency === "INR" ? formatted : `≈${formatted}`;
    },
    [convert, formatter, effectiveCurrency],
  );

  const availableCurrencies = useMemo<CurrencyMeta[]>(() => {
    const rateKeys = ratesData?.rates ? Object.keys(ratesData.rates) : [];
    if (rateKeys.length === 0) {
      return [...SUPPORTED_CURRENCIES];
    }
    const set = new Set(["INR", ...rateKeys.map((k) => k.toUpperCase())]);
    const known = SUPPORTED_CURRENCIES.filter((c) => set.has(c.code));
    const knownCodes = new Set(known.map((c) => c.code));
    const extras: CurrencyMeta[] = [];
    for (const code of set) {
      if (!knownCodes.has(code) && /^[A-Z]{3}$/.test(code)) {
        extras.push({
          code,
          symbol: getCurrencySymbol(code),
          name: getCurrencyName(code),
          decimals: 0,
        });
      }
    }
    return [...known, ...extras];
  }, [ratesData]);

  const symbol = useMemo(
    () => getCurrencySymbol(effectiveCurrency),
    [effectiveCurrency],
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency: effectiveCurrency,
      setCurrency,
      format,
      convert,
      toInr,
      ready,
      symbol,
      ratesDate: ratesData?.date || null,
      attribution: ratesData?.attribution ?? null,
      availableCurrencies,
    }),
    [
      effectiveCurrency,
      setCurrency,
      format,
      convert,
      toInr,
      ready,
      symbol,
      ratesData,
      availableCurrencies,
    ],
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

export function CurrencyPicker() {
  const { currency, setCurrency, symbol, availableCurrencies } = useCurrency();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    function handlePointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableCurrencies;
    return availableCurrencies.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q),
    );
  }, [availableCurrencies, search]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((prev) => {
            if (!prev) setSearch("");
            return !prev;
          });
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Currency: ${currency} (${symbol})`}
        className="glass-field focus-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
      >
        <span className="text-[var(--accent)] font-bold">{symbol}</span>
        <span className="tabular-nums">{currency}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose currency"
          className="glass-strong absolute right-0 top-full z-40 mt-2 w-72 p-3 animate-results"
        >
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] px-1">
              Display currency
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="Close currency picker"
              className="glass-field focus-ring inline-flex min-h-[44px] h-11 w-11 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <input
            ref={searchInputRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search currency (e.g. USD, Euro)…"
            aria-label="Search currencies"
            className="glass-field min-h-[44px] w-full rounded-xl px-3 py-2 text-xs sm:text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/70"
          />

          <ul
            role="listbox"
            aria-label="Supported currencies"
            className="mt-2 max-h-60 overflow-y-auto grid gap-1 pr-0.5"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                No matching currency
              </li>
            ) : (
              filtered.map((c) => {
                const active = c.code === currency;
                return (
                  <li key={c.code} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrency(c.code);
                        setOpen(false);
                        triggerRef.current?.focus();
                      }}
                      className={`focus-ring flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs sm:text-sm transition-colors cursor-pointer ${
                        active
                          ? "glass-selected font-semibold text-[var(--text-primary)]"
                          : "hover:bg-[var(--glass-bg-subtle-hover)] text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-slate-500/10 px-1.5 text-xs font-bold text-[var(--accent)] tabular-nums">
                          {c.symbol}
                        </span>
                        <span className="truncate">
                          <strong className="font-semibold">{c.code}</strong>{" "}
                          <span className="text-[var(--text-secondary)]">
                            · {c.name}
                          </span>
                        </span>
                      </span>
                      {active && (
                        <CheckIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
