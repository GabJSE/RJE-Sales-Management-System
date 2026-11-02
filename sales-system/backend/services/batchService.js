// Keep request concurrency bounded and drain in-flight work before propagating a failure.
export async function forEachBatch(items, concurrency, worker) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("Concurrency must be a positive integer.");
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const results = await Promise.allSettled(items.slice(offset, offset + concurrency).map(item => Promise.resolve().then(() => worker(item))));
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
