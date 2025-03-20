import { strictEqual } from "assert";

import { Auth } from "../dist/auth.js";

describe("Auth", () => {
  it("should indicate correctly when token expired", () => {
    const auth = new Auth({
      hassUrl: "",
      clientId: "",
      refresh_token: "",
      access_token: "",
      expires_in: 3000,
      expires: Date.now() - 1000,
    });
    strictEqual(auth.expired, true);
  });
  it("should indicate correctly when token not expired", () => {
    const auth = new Auth({
      hassUrl: "",
      clientId: "",
      refresh_token: "",
      access_token: "",
      expires_in: 3000,
      expires: Date.now() + 1000,
    });
    strictEqual(auth.expired, false);
  });
});
