import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkInviteEmails, domainAcceptsMail, setMailDnsResolverForTests, type MailDnsResolver } from '../invite-email-check';

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
