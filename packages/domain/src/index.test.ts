import { describe, expect, it } from "vitest";
import {
  applyDecision,
  availabilityOf,
  canAccess,
  canAdjustStock,
  canChangeProductStatus,
  canPlatform,
  canSubmitVerification,
  commissionMinor,
  type Membership,
  nextFulfilmentSteps,
  normalizeCameroonPhone,
  normalizeSku,
  parsePriceMinor,
  permissionForProductStatus,
  phoneMatchesPrefixes,
  roundCoordinate,
  toSearchQuery,
} from "./index";

const membership: Membership = {
  userId: "u1",
  tenantId: "t1",
  storeId: "s1",
  role: "OWNER",
  active: true,
};
const input = {
  userId: "u1",
  tenantId: "t1",
  storeId: "s1",
  permission: "catalog:write" as const,
  tenantStatus: "ACTIVE" as const,
  membership,
};
describe("tenant authorization policy", () => {
  it("allows an active matching membership", () =>
    expect(canAccess(input)).toBe(true));
  it.each([
    { tenantId: "t2" },
    { storeId: "s2" },
    { userId: "u2" },
    { tenantStatus: "SUSPENDED" as const },
    {
      tenantStatus: "PENDING" as const,
      permission: "catalog:publish" as const,
    },
    { membership: { ...membership, active: false } },
    { membership: { ...membership, role: "FULFILLMENT" as const } },
  ])("denies a mismatched or inactive context %j", (change) =>
    expect(canAccess({ ...input, ...change })).toBe(false),
  );
  it("lets every role of a pending tenant read its store, nothing more", () => {
    for (const role of [
      "OWNER",
      "MANAGER",
      "CATALOG",
      "FULFILLMENT",
    ] as const) {
      const pending = {
        ...input,
        tenantStatus: "PENDING" as const,
        membership: { ...membership, role },
      };
      expect(canAccess({ ...pending, permission: "store:read" })).toBe(true);
      expect(canAccess({ ...pending, permission: "order:read" })).toBe(false);
    }
  });
  it("denies store reads once the tenant is suspended", () =>
    expect(
      canAccess({
        ...input,
        permission: "store:read",
        tenantStatus: "SUSPENDED",
      }),
    ).toBe(false));
});
describe("exact commission arithmetic — simulation only", () => {
  it("handles large values and half-up rounding", () => {
    expect(commissionMinor(10n, 500)).toBe(1n);
    expect(commissionMinor(10000n, 400)).toBe(400n);
    expect(commissionMinor(900719925474099300n, 500)).toBe(45035996273704965n);
  });
  it.each([-1, 0.5, 10001])("rejects invalid basis points %s", (rate) =>
    expect(() => commissionMinor(100n, rate)).toThrow(),
  );
  it("rejects negative amounts", () =>
    expect(() => commissionMinor(-1n, 500)).toThrow());
});

describe("platform staff policy", () => {
  it("requires an attested second factor for every role", () => {
    for (const role of ["ADMIN", "SUPPORT"] as const)
      expect(
        canPlatform({ role, mfa: false, permission: "merchant:review" }),
      ).toBe(false);
  });
  it("lets support review but never decide", () => {
    expect(
      canPlatform({
        role: "SUPPORT",
        mfa: true,
        permission: "merchant:review",
      }),
    ).toBe(true);
    expect(
      canPlatform({
        role: "SUPPORT",
        mfa: true,
        permission: "merchant:decide",
      }),
    ).toBe(false);
    expect(
      canPlatform({ role: "ADMIN", mfa: true, permission: "merchant:decide" }),
    ).toBe(true);
  });
  it("lets support see payments but only admins configure methods", () => {
    expect(
      canPlatform({ role: "SUPPORT", mfa: true, permission: "payment:review" }),
    ).toBe(true);
    expect(
      canPlatform({
        role: "SUPPORT",
        mfa: true,
        permission: "payment:configure",
      }),
    ).toBe(false);
    expect(
      canPlatform({
        role: "ADMIN",
        mfa: true,
        permission: "payment:configure",
      }),
    ).toBe(true);
  });
  it("denies users without a platform role", () =>
    expect(
      canPlatform({ role: null, mfa: true, permission: "merchant:review" }),
    ).toBe(false));
});

describe("merchant verification state machine", () => {
  it("approves or rejects only a submitted request", () => {
    expect(applyDecision("SUBMITTED", "APPROVE")).toEqual({
      status: "APPROVED",
      tenantStatus: "ACTIVE",
    });
    expect(applyDecision("SUBMITTED", "REJECT")).toEqual({
      status: "REJECTED",
      tenantStatus: "PENDING",
    });
    for (const status of [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "SUSPENDED",
    ] as const)
      expect(applyDecision(status, "APPROVE")).toBeNull();
  });
  it("suspends only an approved merchant", () => {
    expect(applyDecision("APPROVED", "SUSPEND")).toEqual({
      status: "SUSPENDED",
      tenantStatus: "SUSPENDED",
    });
    expect(applyDecision("SUBMITTED", "SUSPEND")).toBeNull();
  });
  it("allows resubmission after rejection, never after approval", () => {
    expect(canSubmitVerification("PENDING")).toBe(true);
    expect(canSubmitVerification("REJECTED")).toBe(true);
    expect(canSubmitVerification("SUBMITTED")).toBe(false);
    expect(canSubmitVerification("APPROVED")).toBe(false);
    expect(canSubmitVerification("SUSPENDED")).toBe(false);
  });
});

describe("catalogue permissions by tenant status", () => {
  const pending = { ...input, tenantStatus: "PENDING" as const };
  it("lets a pending seller prepare drafts and stock but not publish", () => {
    expect(canAccess({ ...pending, permission: "catalog:write" })).toBe(true);
    expect(canAccess({ ...pending, permission: "inventory:write" })).toBe(true);
    expect(canAccess({ ...pending, permission: "catalog:publish" })).toBe(
      false,
    );
    expect(canAccess({ ...input, permission: "catalog:publish" })).toBe(true);
  });
  it("keeps fulfilment staff away from the catalogue", () => {
    const fulfilment = {
      ...input,
      membership: { ...membership, role: "FULFILLMENT" as const },
    };
    expect(canAccess({ ...fulfilment, permission: "inventory:write" })).toBe(
      true,
    );
    expect(canAccess({ ...fulfilment, permission: "catalog:write" })).toBe(
      false,
    );
  });
});

describe("exact prices, SKUs and stock adjustments", () => {
  it("parses whole minor units only", () => {
    expect(parsePriceMinor("15000")).toBe(15000n);
    expect(parsePriceMinor(" 999999999999999 ")).toBe(999999999999999n);
    for (const bad of ["0", "-5", "12.5", "1e3", "", "abc", "1000000000000000"])
      expect(parsePriceMinor(bad)).toBeNull();
  });
  it("normalises SKUs and rejects unsafe ones", () => {
    expect(normalizeSku(" tsh-rouge-m ")).toBe("TSH-ROUGE-M");
    for (const bad of ["", "-start", "a b", "<x>", "x".repeat(65)])
      expect(normalizeSku(bad)).toBeNull();
  });
  it("never lets physical stock drop below reservations", () => {
    expect(canAdjustStock({ onHand: 10, reserved: 4 }, -6)).toBe(true);
    expect(canAdjustStock({ onHand: 10, reserved: 4 }, -7)).toBe(false);
    expect(canAdjustStock({ onHand: 0, reserved: 0 }, 0)).toBe(false);
    expect(canAdjustStock({ onHand: 0, reserved: 0 }, 1.5)).toBe(false);
  });
  it("reinstates only a suspended merchant", () => {
    expect(applyDecision("SUSPENDED", "REINSTATE")).toEqual({
      status: "APPROVED",
      tenantStatus: "ACTIVE",
    });
    expect(applyDecision("APPROVED", "REINSTATE")).toBeNull();
  });
});

describe("product lifecycle", () => {
  it("publishes drafts, unpublishes and archives, restores archives as drafts", () => {
    expect(canChangeProductStatus("DRAFT", "PUBLISHED")).toBe(true);
    expect(canChangeProductStatus("PUBLISHED", "DRAFT")).toBe(true);
    expect(canChangeProductStatus("PUBLISHED", "ARCHIVED")).toBe(true);
    expect(canChangeProductStatus("ARCHIVED", "PUBLISHED")).toBe(false);
    expect(canChangeProductStatus("DRAFT", "DRAFT")).toBe(false);
  });
  it("requires the publish permission only to publish", () => {
    expect(permissionForProductStatus("PUBLISHED")).toBe("catalog:publish");
    expect(permissionForProductStatus("ARCHIVED")).toBe("catalog:write");
  });
});

describe("storefront helpers", () => {
  it("exposes availability levels, never quantities", () => {
    expect(availabilityOf(0)).toBe("out_of_stock");
    expect(availabilityOf(-2)).toBe("out_of_stock");
    expect(availabilityOf(3)).toBe("low_stock");
    expect(availabilityOf(4)).toBe("in_stock");
  });
  it("builds a safe prefix query from free text", () => {
    expect(toSearchQuery("Pagne  WAX!")).toBe("pagne:* & wax:*");
    expect(toSearchQuery("élégant")).toBe("élégant:*");
    expect(toSearchQuery("'); DROP TABLE x; -- & | !")).toBe(
      "drop:* & table:*",
    );
    expect(toSearchQuery("a ! &")).toBeNull();
    expect(
      toSearchQuery(
        "a b c d e f g h i j k l m n o p".replaceAll(" ", "x "),
      )?.split("&"),
    ).toHaveLength(6);
  });
});

describe("local delivery data", () => {
  it("normalises Cameroonian numbers to E.164", () => {
    for (const input of [
      "699 12 34 56",
      "+237 699123456",
      "00237699123456",
      "699-12-34-56",
    ])
      expect(normalizeCameroonPhone(input)).toBe("+237699123456");
    expect(normalizeCameroonPhone("233 42 11 00")).toBe("+237233421100");
    for (const bad of [
      "12345",
      "+33612345678",
      "799123456",
      "6991234567",
      "abc",
    ])
      expect(normalizeCameroonPhone(bad)).toBeNull();
  });
  it("keeps coordinates coarse and valid", () => {
    expect(roundCoordinate(4.051234567, 90)).toBe(4.0512);
    expect(roundCoordinate(9.767891, 180)).toBe(9.7679);
    expect(roundCoordinate(91, 90)).toBeNull();
    expect(roundCoordinate(Number.NaN, 180)).toBeNull();
  });
  it("lets owners and managers configure delivery options", () => {
    expect(canAccess({ ...input, permission: "store:configure" })).toBe(true);
    expect(
      canAccess({
        ...input,
        permission: "store:configure",
        membership: { ...membership, role: "CATALOG" as const },
      }),
    ).toBe(false);
  });
});

describe("operator phone prefixes", () => {
  it("accepts any number without configured prefixes, else only matching ones", () => {
    expect(phoneMatchesPrefixes("+237677000000", [])).toBe(true);
    expect(phoneMatchesPrefixes("+237677000000", ["+23767", "+23768"])).toBe(
      true,
    );
    expect(phoneMatchesPrefixes("+237699000000", ["+23767", "+23768"])).toBe(
      false,
    );
  });
});

describe("fulfilment state machine", () => {
  it("delivers at home through a courier, pickups at the counter", () => {
    expect(nextFulfilmentSteps("HOME_DELIVERY", "TO_PREPARE")).toEqual([
      "READY",
    ]);
    expect(nextFulfilmentSteps("HOME_DELIVERY", "READY")).toEqual([
      "OUT_FOR_DELIVERY",
    ]);
    expect(nextFulfilmentSteps("PICKUP", "READY")).toEqual(["DELIVERED"]);
    expect(nextFulfilmentSteps("HOME_DELIVERY", "OUT_FOR_DELIVERY")).toEqual([
      "DELIVERED",
      "DELIVERY_FAILED",
    ]);
    expect(nextFulfilmentSteps("HOME_DELIVERY", "DELIVERY_FAILED")).toEqual([
      "OUT_FOR_DELIVERY",
    ]);
  });
  it("never moves an unpaid or delivered order", () => {
    for (const method of ["HOME_DELIVERY", "PICKUP"] as const) {
      expect(nextFulfilmentSteps(method, "AWAITING_PAYMENT")).toEqual([]);
      expect(nextFulfilmentSteps(method, "DELIVERED")).toEqual([]);
    }
  });
});
