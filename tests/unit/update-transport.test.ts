import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { requests } = vi.hoisted(() => ({ requests: [] as (EventEmitter & { followRedirect(): void })[] }));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeRequest extends EventEmitter {
    constructor() {
      super();
      requests.push(this);
    }
    setHeader() {}
    end() {}
    followRedirect() {}
    abort() {
      this.emit('abort');
    }
  }
  return {
    app: { getVersion: () => '1.0.0' },
    net: { request: () => new FakeRequest() },
    session: { fromPartition: () => ({ webRequest: { onBeforeRequest: () => undefined }, setPermissionRequestHandler: () => undefined }) },
  };
});

import { electronTransport } from '../../src/main/update/transport';

const FEED = 'https://example.test/update.json';
const INSTALLER = 'https://example.test/Planner-Setup-1.1.0.exe';

function respond(): EventEmitter {
  const response = Object.assign(new EventEmitter(), { statusCode: 200 });
  requests[0]!.emit('response', response);
  return response;
}

afterEach(() => {
  vi.useRealTimers();
  requests.length = 0;
});

describe('update transport', () => {
  it('lets a slow but steady download finish, however long it takes in total', async () => {
    vi.useFakeTimers();
    const destination = join(mkdtempSync(join(tmpdir(), 'planner-update-')), 'Planner-Setup.exe');
    const result = electronTransport.download(INSTALLER, destination, { maxBytes: 1024, onProgress: () => undefined });
    result.catch(() => undefined);
    const response = respond();
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(40_000);
      response.emit('data', Buffer.from('ab'));
    }
    vi.useRealTimers();
    response.emit('end');
    await result;
    expect(readFileSync(destination, 'utf8')).toBe('abababab');
  });

  it('gives up on an update check that keeps trickling in', async () => {
    vi.useFakeTimers();
    const result = electronTransport.fetchText(FEED, 1024);
    result.catch(() => undefined);
    const response = respond();
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      response.emit('data', Buffer.from('a'));
    }
    await expect(result).rejects.toThrow('timeout');
  });

  it('gives up on a connection that stops sending', async () => {
    vi.useFakeTimers();
    const result = electronTransport.fetchText(FEED, 1024);
    result.catch(() => undefined);
    respond().emit('data', Buffer.from('ab'));
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(result).rejects.toThrow('timeout');
  });

  it('refuses a redirect away from HTTPS', async () => {
    const result = electronTransport.fetchText(FEED, 1024);
    requests[0]!.emit('redirect', 302, 'GET', 'http://example.test/update.json');
    await expect(result).rejects.toThrow('INSECURE_URL');
  });
});
