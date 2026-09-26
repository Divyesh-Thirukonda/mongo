import test from "node:test";
import assert from "node:assert/strict";
import { loadStorefront } from "../src/storefront.js";

test("storefront exports an async adapter", () => {
  assert.equal(typeof loadStorefront, "function");
});
