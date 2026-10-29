import { expect, it } from "vitest";
import { hashSessionToken, issueSessionToken } from "./session";

it("issues independent high-entropy tokens and stores only a digest", () => {
  const first = issueSessionToken();
  const second = issueSessionToken();
  expect(first.token).not.toBe(second.token);
  expect(first.tokenHash).toHaveLength(64);
  expect(hashSessionToken(first.token)).toBe(first.tokenHash);
  expect(first.tokenHash).not.toContain(first.token);
});
