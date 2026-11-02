import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

test('all backend route modules load and register callable handlers without connecting to MongoDB', async () => {
  const directory = new URL('../routes/', import.meta.url);
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.js')) continue;
    const { default: router } = await import(new URL(file, directory));
    assert.equal(typeof router, 'function', file);
    assert.ok(Array.isArray(router.stack), file);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const handler of layer.route.stack) assert.equal(typeof handler.handle, 'function', `${file}: ${layer.route.path}`);
    }
  }
});
