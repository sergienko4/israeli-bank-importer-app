/**
 * Proves the process always renews from a refresh token the portal still
 * accepts, even when storage lags behind because a save failed.
 */
import type { Connection } from './connectionStore';
import { createTokenLedger } from './tokenLedger';

const BASE_URL = 'https://importer.example.ts.net';

function pair(refreshToken: string, overrides: Partial<Connection> = {}): Connection {
  return {
    baseUrl: BASE_URL,
    accessToken: `access-for-${refreshToken}`,
    refreshToken,
    expiresAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('createTokenLedger', () => {
  it('trusts storage before this process has renewed anything', () => {
    const ledger = createTokenLedger();
    expect(ledger.current(pair('refresh-1'))).toEqual(pair('refresh-1'));
  });

  it('answers with its own renewal when storage still names the spent token', () => {
    const ledger = createTokenLedger();
    ledger.record(pair('refresh-1'), pair('refresh-2'));
    expect(ledger.current(pair('refresh-1'))).toEqual(pair('refresh-2'));
  });

  it('answers with the real pair when storage holds the renewal saved withheld', () => {
    const ledger = createTokenLedger();
    ledger.record(pair('refresh-1'), pair('refresh-2'));
    const withheld = pair('refresh-2', { accessToken: '', expiresAt: 0 });
    expect(ledger.current(withheld)).toEqual(pair('refresh-2'));
  });

  it('remembers every token spent while saves kept failing', () => {
    const ledger = createTokenLedger();
    ledger.record(pair('refresh-1'), pair('refresh-2'));
    ledger.record(pair('refresh-2'), pair('refresh-3'));
    expect(ledger.current(pair('refresh-1'))).toEqual(pair('refresh-3'));
  });

  it('defers to a pair it did not issue, such as a new sign-in', () => {
    const ledger = createTokenLedger();
    ledger.record(pair('refresh-1'), pair('refresh-2'));
    expect(ledger.current(pair('refresh-signed-in'))).toEqual(pair('refresh-signed-in'));
  });

  it('never mixes importers', () => {
    const ledger = createTokenLedger();
    ledger.record(pair('refresh-1'), pair('refresh-2'));
    const other = pair('refresh-1', { baseUrl: 'https://other.example.ts.net' });
    expect(ledger.current(other)).toEqual(other);
  });

  it('starts a fresh chain when a renewal did not continue its own', () => {
    const ledger = createTokenLedger();
    ledger.record(pair('refresh-1'), pair('refresh-2'));
    ledger.record(pair('refresh-signed-in'), pair('refresh-9'));
    expect(ledger.current(pair('refresh-1'))).toEqual(pair('refresh-1'));
  });

  it('knows nothing once forgotten', () => {
    const ledger = createTokenLedger();
    ledger.record(pair('refresh-1'), pair('refresh-2'));
    ledger.forget();
    expect(ledger.current(pair('refresh-1'))).toEqual(pair('refresh-1'));
  });
});
