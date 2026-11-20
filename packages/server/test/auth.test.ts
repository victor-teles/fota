import { describe, expect, test } from "bun:test";
import { staticApiKeys } from "../src/auth";

function request(authorization?: string) {
  return new Request("http://localhost/v1/apps", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("staticApiKeys", () => {
  const auth = staticApiKeys(["first-key", "second-key"]);

  test("accepts any configured bearer key", async () => {
    expect(await auth.authorize(request("Bearer first-key"))).toBe(true);
    expect(await auth.authorize(request("Bearer second-key"))).toBe(true);
  });

  test.each([
    undefined,
    "",
    "Bearer",
    "Bearer ",
    "Bearer wrong",
    "Bearer first-key2",
    "Bearer first-key extra",
    "Basic first-key",
    "first-key",
  ])("rejects %p", async (header) => {
    expect(await auth.authorize(request(header))).toBe(false);
  });

  test("refuses to be built without keys", () => {
    expect(() => staticApiKeys([])).toThrow();
    expect(() => staticApiKeys(["ok", ""])).toThrow();
  });
});
