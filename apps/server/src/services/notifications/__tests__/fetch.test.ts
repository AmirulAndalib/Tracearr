import { UnrecoverableError } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFetchOptions, deliverFetch } from '../destinations/fetch.js';

const ctx = { destination: { id: 'd', name: 'D' }, signal: AbortSignal.timeout(5000) };

describe('deliverFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects link-local urls with UnrecoverableError before fetching', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(
      deliverFetch('http://169.254.169.254/x', { method: 'POST' }, ctx)
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(f).not.toHaveBeenCalled();
  });

  it('allows LAN urls, passes the signal, and throws on non-2xx with status and body', async () => {
    const f = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', f);
    await expect(deliverFetch('http://192.168.1.10/hook', { method: 'POST' }, ctx)).rejects.toThrow(
      /500 nope/
    );
    expect(f.mock.calls[0]?.[1]).toMatchObject({ signal: ctx.signal });
  });

  it('moves embedded basic auth into a header', () => {
    const { url, headers } = buildFetchOptions('https://user:pa%40ss@example.com/x');
    expect(url).toBe('https://example.com/x');
    expect(headers['Authorization']).toBe(`Basic ${btoa('user:pa@ss')}`);
  });

  it('resolves on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(
      deliverFetch('https://example.com', { method: 'POST' }, ctx)
    ).resolves.toBeUndefined();
  });
});
