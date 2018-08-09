import assert from "assert";

import { Auth } from "../lib/auth";

describe("Auth", () => {
  it("should indicate correctly when token expired", () => {
    const auth = new Auth({
      expires: Date.now()
    });
    assert.strictEqual(auth.expired, true);
  });
  it("should indicate correctly when token not expired", () => {
    const auth = new Auth({
      expires: Date.now() + 20000
    });
    assert.strictEqual(auth.expired, false);
  });
});
