import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import { RuntimeManifestSchema } from '../src/runtime/manifest';

describe('runtime discovery API', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => closeServer?.());

  it('exposes an unauthenticated, versioned runtime manifest', async () => {
    process.env.RUNTIME_BACKEND = 'local';
    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runtime`;

    const response = await fetch(`${baseUrl}/manifest`);
    expect(response.status).toBe(200);
    const manifest = RuntimeManifestSchema.parse(await response.json());
    expect(manifest.runtime_id).toBe('ego-runtime');
    expect(manifest.supported_backends).toEqual(['local', 'cloud']);
  });

  it('keeps the legacy capabilities response compatible and points to the manifest', async () => {
    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runtime`;

    const response = await fetch(`${baseUrl}/capabilities`);
    const capabilities = await response.json() as Record<string, unknown>;
    expect(capabilities.runtime).toBe('ego-runtime');
    expect(capabilities.capabilities).toBeInstanceOf(Array);
    expect(capabilities.manifest_url).toBe('/v1/runtime/manifest');
    expect(capabilities.manifest_version).toBe('1.0');
  });


  it("rejects work requiring capabilities absent from the manifest", async () => {
    process.env.INTERNAL_RUNTIME_TOKEN = "manifest-test-token";
    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    closeServer = () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    const baseUrl = "http://127.0.0.1:" + (server.address() as AddressInfo).port + "/v1/runtime";

    const response = await fetch(baseUrl + "/execute", {
      method: "POST",
      headers: { Authorization: "Bearer manifest-test-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: "unsupported_request", user_id: "user", session_id: "session",
        objective_id: "objective", message: "Run an unsupported tool",
        capabilities: ["unknown.tool", "unknown.tool"],
      }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "UNSUPPORTED_CAPABILITIES", unsupported_capabilities: ["unknown.tool"],
    });
  });
});
