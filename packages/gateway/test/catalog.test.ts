import { describe, expect, it } from "vitest";
import { categoryFor, loadCatalogFile, parseCatalog } from "@countersign/gateway";

const CATALOG = loadCatalogFile(new URL("../../../config/catalog.json", import.meta.url));

describe("endpoint catalog (D3)", () => {
  it("loads config/catalog.json", () => {
    expect(CATALOG).toEqual([
      { pathPrefix: "/api/weather", category: "weather" },
      { pathPrefix: "/api/forecast", category: "weather" },
      { pathPrefix: "/api/crypto", category: "crypto-prices" },
      { pathPrefix: "/api/report", category: "research" },
    ]);
  });

  it("maps endpoint URLs to categories, ignoring host and query", () => {
    expect(categoryFor("http://127.0.0.1:4101/api/weather?tier=basic&qty=2", CATALOG)).toBe("weather");
    expect(categoryFor("http://127.0.0.1:4101/api/forecast?city=Berkeley", CATALOG)).toBe("weather");
    expect(categoryFor("http://127.0.0.1:4101/api/crypto?symbol=BTC", CATALOG)).toBe("crypto-prices");
  });

  it("matches only on path-segment boundaries; unknown or bad URLs are null", () => {
    expect(categoryFor("http://h/api/weatherx", CATALOG)).toBeNull();
    expect(categoryFor("http://h/api/weather/today", CATALOG)).toBe("weather");
    expect(categoryFor("http://h/docs", CATALOG)).toBeNull();
    expect(categoryFor("not a url", CATALOG)).toBeNull();
  });

  it("longest prefix wins", () => {
    const c = [
      { pathPrefix: "/api", category: "general" },
      { pathPrefix: "/api/crypto", category: "Crypto Prices" },
    ];
    expect(categoryFor("http://h/api/crypto?x=1", c)).toBe("crypto-prices");
    expect(categoryFor("http://h/api/other", c)).toBe("general");
  });

  it("rejects malformed catalog entries", () => {
    expect(() => parseCatalog([{ pathPrefix: "api/weather", category: "weather" }])).toThrow();
    expect(() => parseCatalog([{ pathPrefix: "/api/weather", category: "" }])).toThrow();
    expect(() => parseCatalog({})).toThrow();
    expect(() => parseCatalog([{ pathPrefix: "/api/x", category: "!!!" }])).toThrow();
    expect(() => parseCatalog([{ pathPrefix: "/api/x", category: "天気" }])).toThrow();
  });

  it("categoryFor never returns an empty string", () => {
    const c = [{ pathPrefix: "/api/x", category: "!!!" }];
    expect(categoryFor("http://h/api/x", c)).toBeNull();
  });
});
