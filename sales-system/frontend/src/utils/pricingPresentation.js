export function meetsPricingTarget(pricing) {
  const margin = pricing?.currentProjection?.margin;
  return typeof margin === "number" && Number.isFinite(margin) && margin >= 20;
}
