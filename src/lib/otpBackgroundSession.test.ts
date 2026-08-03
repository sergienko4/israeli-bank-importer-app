/**
 * Covers which stored connections the background paths will act on.
 */
import type { Connection } from '../auth/connectionStore';
import { backgroundSession } from './otpBackgroundSession';

const NOW = 1_700_000_000_000;

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    baseUrl: 'https://importer.local',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

describe('backgroundSession', () => {
  it('has nothing to work with when the device was never paired', () => {
    expect(backgroundSession(null, NOW)).toBeNull();
  });

  it('uses a live connection', () => {
    expect(backgroundSession(connection(), NOW)).toEqual({
      baseUrl: 'https://importer.local',
      token: 'access-token',
    });
  });

  it('refuses an expired token rather than renewing it', () => {
    // Renewing needs a biometric prompt, which is exactly the interaction this
    // feature removes. An expired token means the user types the code instead.
    expect(backgroundSession(connection({ expiresAt: NOW - 1 }), NOW)).toBeNull();
  });

  it('refuses a token that expires on this very millisecond', () => {
    expect(backgroundSession(connection({ expiresAt: NOW }), NOW)).toBeNull();
  });

  it('still uses a token with only seconds left, unlike the foreground path', () => {
    // The foreground code renews anything inside a two-minute margin. A one-shot
    // background submit does not need that headroom, so the margin is not applied.
    expect(backgroundSession(connection({ expiresAt: NOW + 1000 }), NOW)).not.toBeNull();
  });
});
