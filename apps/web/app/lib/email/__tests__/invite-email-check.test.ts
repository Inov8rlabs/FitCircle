import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DNS_CACHE_TTL_MS,
  checkInviteEmails,
  domainAcceptsMail,
  mxCheckEnabled,
  setMailDnsResolverForTests,
  type MailDnsResolver,
} from '../invite-email-check';

const err = (code: string) => Object.assign(new Error(code), { code });

function fakeResolver(table: Record<string, { mx?: string[] | string; a?: string[] | string; aaaa?: string[] | string }>): MailDnsResolver & {
  calls: string[];
} {
  const calls: string[] = [];
  const answer = (v: string[] | string | undefined) => (typeof v === 'string' ? Promise.reject(err(v)) : Promise.resolve(v ?? []));
  return {
    calls,
    resolveMx: (d) => {
      calls.push(`mx:${d}`);
      const v = table[d]?.mx ?? 'ENOTFOUND';
      return typeof v === 'string' ? Promise.reject(err(v)) : Promise.resolve(v.map((exchange) => ({ exchange, priority: 10 })));
    },
    resolve4: (d) => answer(table[d]?.a ?? 'ENOTFOUND'),
    resolve6: (d) => answer(table[d]?.aaaa ?? 'ENOTFOUND'),
  };
}

afterEach(() => {
  setMailDnsResolverForTests(null);
  vi.useRealTimers();
});

describe('checkInviteEmails', () => {
  it('returns per-address errors with the request index, plus normalized addresses for the rest', async () => {
    const { invalid, normalized } = await checkInviteEmails([
      { index: 0, email: ' Sam@Example.COM ' },
      { index: 1, email: 'r.celeste1957@yahoo.comr' },
      { index: 3, email: '' },
    ]);
    expect(invalid).toEqual([
      { index: 1, email: 'r.celeste1957@yahoo.comr', reason: 'unknown_tld', suggestion: 'r.celeste1957@yahoo.com' },
      { index: 3, email: '', reason: 'empty' },
    ]);
    expect(normalized.get(0)).toBe('Sam@example.com');
    expect(normalized.has(1)).toBe(false);
  });

  it('skips DNS under vitest unless a resolver is installed', async () => {
    expect(await domainAcceptsMail('surely-not-a-real-domain-zz9.com')).toBe(true);
  });
});

describe('DNS deliverability check', () => {
  it('rejects a domain with no MX and no A/AAAA as domain_not_found', async () => {
    setMailDnsResolverForTests(fakeResolver({}));
    const { invalid } = await checkInviteEmails([{ index: 0, email: 'sam@no-such-domain-zz9.com' }]);
    expect(invalid).toEqual([{ index: 0, email: 'sam@no-such-domain-zz9.com', reason: 'domain_not_found' }]);
  });

  it('accepts MX, or A as implicit MX', async () => {
    setMailDnsResolverForTests(fakeResolver({ 'acme.io': { mx: ['mx.acme.io'] }, 'tiny.dev': { mx: 'ENODATA', a: ['1.2.3.4'] } }));
    expect(await domainAcceptsMail('acme.io')).toBe(true);
    expect(await domainAcceptsMail('tiny.dev')).toBe(true);
  });

  it('rejects a null MX (RFC 7505)', async () => {
    setMailDnsResolverForTests(fakeResolver({ 'nomail.org': { mx: ['.'], a: ['1.2.3.4'] } }));
    expect(await domainAcceptsMail('nomail.org')).toBe(false);
  });

  it('fails open on resolver errors and timeouts', async () => {
    setMailDnsResolverForTests(fakeResolver({ 'flaky.net': { mx: 'ESERVFAIL' } }));
    expect(await domainAcceptsMail('flaky.net')).toBe(true);

    vi.useFakeTimers();
    setMailDnsResolverForTests({
      resolveMx: () => new Promise(() => {}),
      resolve4: () => new Promise(() => {}),
      resolve6: () => new Promise(() => {}),
    });
    const pending = domainAcceptsMail('slow.example.org');
    await vi.advanceTimersByTimeAsync(1600);
    expect(await pending).toBe(true);
  });

  it('never looks up the big providers, and caches per domain', async () => {
    const r = fakeResolver({ 'acme.io': { mx: ['mx.acme.io'] } });
    setMailDnsResolverForTests(r);
    await checkInviteEmails([
      { index: 0, email: 'a@gmail.com' },
      { index: 1, email: 'b@acme.io' },
      { index: 2, email: 'c@acme.io' },
    ]);
    await domainAcceptsMail('acme.io');
    expect(r.calls).toEqual(['mx:acme.io']);
  });

  it('can be switched off with INVITE_EMAIL_MX_CHECK=off', async () => {
    setMailDnsResolverForTests(fakeResolver({}));
    process.env.INVITE_EMAIL_MX_CHECK = 'off';
    try {
      expect(await domainAcceptsMail('no-such-domain-zz9.com')).toBe(true);
    } finally {
      delete process.env.INVITE_EMAIL_MX_CHECK;
    }
  });
});

describe('never block on an MX lookup timeout (only signal = timeout)', () => {
  const hang = () => new Promise<never>(() => {});

  it('MX times out, A/AAAA would say NXDOMAIN: still allowed (A/AAAA are not even consulted)', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    setMailDnsResolverForTests({
      resolveMx: () => (calls.push('mx'), hang()),
      resolve4: () => (calls.push('a'), Promise.reject(err('ENOTFOUND'))),
      resolve6: () => (calls.push('aaaa'), Promise.reject(err('ENOTFOUND'))),
    });
    const pending = checkInviteEmails([{ index: 0, email: 'sam@slow-dns-zz9.com' }]);
    await vi.advanceTimersByTimeAsync(1600);
    const { invalid, normalized } = await pending;
    expect(invalid).toEqual([]);
    expect(normalized.get(0)).toBe('sam@slow-dns-zz9.com');
    expect(calls).toEqual(['mx']);
  });

  it('MX says NODATA but the A lookup times out (AAAA NXDOMAIN): allowed', async () => {
    vi.useFakeTimers();
    setMailDnsResolverForTests({
      resolveMx: () => Promise.reject(err('ENODATA')),
      resolve4: () => hang(),
      resolve6: () => Promise.reject(err('ENOTFOUND')),
    });
    const pending = domainAcceptsMail('half-slow-zz9.com');
    await vi.advanceTimersByTimeAsync(1600);
    expect(await pending).toBe(true);
  });

  it('SERVFAIL / ETIMEOUT error codes from the resolver are treated like timeouts', async () => {
    setMailDnsResolverForTests(fakeResolver({ 'a-zz9.com': { mx: 'ETIMEOUT' }, 'b-zz9.com': { mx: 'ENODATA', a: 'ESERVFAIL', aaaa: 'ENOTFOUND' } }));
    expect(await domainAcceptsMail('a-zz9.com')).toBe(true);
    expect(await domainAcceptsMail('b-zz9.com')).toBe(true);
  });

  it('an inconclusive verdict is not cached; a definitive one is (6 h)', async () => {
    let mxAnswer: 'timeout' | 'nx' = 'timeout';
    const calls: string[] = [];
    setMailDnsResolverForTests({
      resolveMx: () => (calls.push('mx'), Promise.reject(err(mxAnswer === 'timeout' ? 'ETIMEOUT' : 'ENOTFOUND'))),
      resolve4: () => Promise.reject(err('ENOTFOUND')),
      resolve6: () => Promise.reject(err('ENOTFOUND')),
    });
    expect(await domainAcceptsMail('later-dead-zz9.com')).toBe(true);
    mxAnswer = 'nx';
    expect(await domainAcceptsMail('later-dead-zz9.com')).toBe(false); // re-queried, not served from cache
    expect(await domainAcceptsMail('later-dead-zz9.com')).toBe(false); // now cached
    expect(calls).toEqual(['mx', 'mx']);
    expect(DNS_CACHE_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('cache expires after 6 h', async () => {
    vi.useFakeTimers();
    const r = fakeResolver({ 'acme.io': { mx: ['mx.acme.io'] } });
    setMailDnsResolverForTests(r);
    await domainAcceptsMail('acme.io');
    vi.advanceTimersByTime(DNS_CACHE_TTL_MS + 1);
    await domainAcceptsMail('acme.io');
    expect(r.calls).toEqual(['mx:acme.io', 'mx:acme.io']);
  });

  it('INVITE_EMAIL_MX_CHECK accepts off/false/0', () => {
    expect(mxCheckEnabled({} as any)).toBe(true);
    expect(mxCheckEnabled({ INVITE_EMAIL_MX_CHECK: 'off' } as any)).toBe(false);
    expect(mxCheckEnabled({ INVITE_EMAIL_MX_CHECK: 'FALSE' } as any)).toBe(false);
    expect(mxCheckEnabled({ INVITE_EMAIL_MX_CHECK: '0' } as any)).toBe(false);
    expect(mxCheckEnabled({ INVITE_EMAIL_MX_CHECK: 'on' } as any)).toBe(true);
  });
});

