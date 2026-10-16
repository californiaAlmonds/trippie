import type { IsoDate } from "./types.ts";

export interface Site {
  key: string;
  label: string;
  verified: boolean; // URL pattern confirmed to load with prefilled search
  url: (o: string, d: string, dep: IsoDate, ret?: IsoDate) => string;
}

const dmy = (d: IsoDate) => d.split("-").reverse().join("/");
const dmyCompact = (d: IsoDate) => d.split("-").reverse().join("");
const yymmdd = (d: IsoDate) => d.slice(2).replaceAll("-", "");

export const SITES: Site[] = [
  {
    key: "google",
    label: "Google Flights",
    verified: true,
    url: (o, d, dep, ret) =>
      `https://www.google.com/travel/flights?curr=INR&q=${encodeURIComponent(
        `Flights to ${d} from ${o} on ${dep}${ret ? ` through ${ret}` : " oneway"}`,
      )}`,
  },
  {
    key: "kayak",
    label: "Kayak India",
    verified: true,
    url: (o, d, dep, ret) => `https://www.kayak.co.in/flights/${o}-${d}/${dep}${ret ? `/${ret}` : ""}`,
  },
  {
    key: "aviasales",
    label: "Aviasales",
    verified: false,
    url: (o, d, dep, ret) => {
      const ddmm = (x: IsoDate) => x.slice(8) + x.slice(5, 7);
      return `https://www.aviasales.com/search/${o}${ddmm(dep)}${d}${ret ? ddmm(ret) : ""}1`;
    },
  },
  {
    key: "makemytrip",
    label: "MakeMyTrip",
    verified: false,
    url: (o, d, dep, ret) =>
      `https://www.makemytrip.com/flight/search?itinerary=${o}-${d}-${dmy(dep)}${
        ret ? `_${d}-${o}-${dmy(ret)}` : ""
      }&tripType=${ret ? "R" : "O"}&paxType=A-1_C-0_I-0&intl=false&cabinClass=E`,
  },
  {
    key: "ixigo",
    label: "ixigo",
    verified: false,
    url: (o, d, dep, ret) =>
      `https://www.ixigo.com/search/result/flight?from=${o}&to=${d}&date=${dmyCompact(dep)}${
        ret ? `&returnDate=${dmyCompact(ret)}` : ""
      }&adults=1&children=0&infants=0&class=e`,
  },
  {
    key: "cleartrip",
    label: "Cleartrip",
    verified: false,
    url: (o, d, dep, ret) =>
      `https://www.cleartrip.com/flights/results?adults=1&childs=0&infants=0&class=Economy&depart_date=${dmy(dep)}${
        ret ? `&return_date=${dmy(ret)}` : ""
      }&from=${o}&to=${d}&intl=n`,
  },
  {
    key: "skyscanner",
    label: "Skyscanner India",
    verified: false,
    url: (o, d, dep, ret) =>
      `https://www.skyscanner.co.in/transport/flights/${o.toLowerCase()}/${d.toLowerCase()}/${yymmdd(dep)}/${
        ret ? `${yymmdd(ret)}/` : ""
      }`,
  },
];

/** Sites ordered with the provider-reported cheapest source first. */
export function orderedSites(bestKey?: string): Site[] {
  return [...SITES].sort((a, b) => Number(b.key === bestKey) - Number(a.key === bestKey));
}
