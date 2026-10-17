import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AIRPORT_DATA_ATTRIBUTION,
  getAirport,
  isKnownAirport,
  searchAirports,
} from "./airports.ts";

test("isKnownAirport and getAirport return accurate airport metadata", () => {
  assert.equal(isKnownAirport("BLR"), true);
  assert.equal(isKnownAirport("blr"), true);
  assert.equal(isKnownAirport("ZZZ"), false);
  assert.equal(isKnownAirport(""), false);
  assert.equal(isKnownAirport("INVALID"), false);

  const blr = getAirport("BLR");
  assert.ok(blr);
  assert.equal(blr.iata, "BLR");
  assert.equal(blr.icao, "VOBL");
  assert.ok(blr.name.includes("Kempegowda"));
  assert.equal(blr.city, "Bengaluru");
  assert.equal(blr.country, "IN");
  assert.equal(blr.countryName, "India");
  assert.ok(Math.abs(blr.lat - 13.1979) < 0.05);
  assert.ok(Math.abs(blr.lon - 77.7063) < 0.05);
  assert.ok(blr.tz?.startsWith("Asia/"));
  assert.equal(blr.size, "large");

  assert.equal(getAirport("ZZZ"), null);
  assert.ok(AIRPORT_DATA_ATTRIBUTION.includes("OurAirports"));
  assert.ok(AIRPORT_DATA_ATTRIBUTION.includes("OpenFlights"));
});

test("searchAirports ranking: exact IATA, prefixes, aliases/exonyms, airport names, and diacritics", () => {
  // Exact IATA match first
  const ccu = searchAirports("ccu");
  assert.ok(ccu.length > 0);
  assert.equal(ccu[0]?.iata, "CCU");

  // City prefix
  const kolk = searchAirports("kolk");
  assert.ok(kolk.length > 0);
  assert.equal(kolk[0]?.iata, "CCU");

  // Historic / alias city names
  const calcutta = searchAirports("calcutta");
  assert.ok(calcutta.length > 0);
  assert.equal(calcutta[0]?.iata, "CCU");

  const bangalore = searchAirports("bangalore");
  assert.ok(bangalore.length > 0);
  assert.equal(bangalore[0]?.iata, "BLR");

  const portBlair = searchAirports("port blair");
  assert.ok(portBlair.length > 0);
  assert.equal(portBlair[0]?.iata, "IXZ");

  const sriVijaya = searchAirports("sri vijaya");
  assert.ok(sriVijaya.length > 0);
  assert.equal(sriVijaya[0]?.iata, "IXZ");

  const gurgaon = searchAirports("gurgaon");
  assert.ok(gurgaon.length > 0);
  assert.equal(gurgaon[0]?.iata, "DEL");

  const bombay = searchAirports("bombay");
  assert.ok(bombay.length > 0);
  assert.equal(bombay[0]?.iata, "BOM");

  const madras = searchAirports("madras");
  assert.ok(madras.length > 0);
  assert.equal(madras[0]?.iata, "MAA");

  // Worldwide hubs & airport names
  const dubai = searchAirports("dubai");
  assert.ok(dubai.length > 0);
  assert.equal(dubai[0]?.iata, "DXB");

  const heathrow = searchAirports("heathrow");
  assert.ok(heathrow.length > 0);
  assert.equal(heathrow[0]?.iata, "LHR");

  const lon = searchAirports("lon");
  assert.ok(lon.length >= 2);
  assert.equal(lon[0]?.iata, "LHR");
  assert.ok(lon.some((a) => a.iata === "LGW"));

  // Diacritics-insensitive search
  const saoPaulo = searchAirports("sao paulo");
  assert.ok(saoPaulo.length >= 2);
  assert.equal(saoPaulo[0]?.iata, "GRU");
  assert.ok(saoPaulo.some((a) => a.iata === "CGH"));

  // Limit clamping and invalid query handling
  assert.equal(searchAirports("lon", 2).length, 2);
  assert.deepEqual(searchAirports(""), []);
  assert.deepEqual(searchAirports("   "), []);
  assert.deepEqual(searchAirports("a".repeat(65)), []);
});
