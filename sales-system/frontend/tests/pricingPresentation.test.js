import test from "node:test";
import assert from "node:assert/strict";
import { meetsPricingTarget } from "../src/utils/pricingPresentation.js";

test("suppress suggestions at or above twenty percent, including zero-cost hundred-percent margins", () => {
  for (const margin of [20, 20.01, 100]) assert.equal(meetsPricingTarget({currentProjection:{margin}}), true);
  for (const margin of [19.9999, 0, -10, null, undefined, NaN]) assert.equal(meetsPricingTarget({currentProjection:{margin}}), false);
  assert.equal(meetsPricingTarget(undefined), false);
});
