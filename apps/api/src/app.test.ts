import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("foundation API contract", () => {
  it("reports liveness without claiming readiness", async () => {
    const app = await createApp();
    try {
      const live = await app.inject("/health/live");
      expect(live.statusCode).toBe(200);
      expect(live.json()).toEqual({
        status: "ok",
        service: "api",
        stage: "foundation",
      });
      expect((await app.inject("/health/ready")).statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });
  it("exports OpenAPI and exposes no write route", async () => {
    const app = await createApp();
    try {
      expect((await app.inject("/openapi.json")).json().openapi).toBe("3.0.3");
      expect(
        (await app.inject({ method: "POST", url: "/orders", payload: {} }))
          .statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
