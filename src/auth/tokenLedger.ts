/**
 * Remembers, for the life of the process, which refresh token is still live.
 *
 * The portal accepts each refresh token once and ends the whole session when
 * one comes back. Storage is the usual record of the live token, but a save can
 * fail after the portal has already rotated, and then storage names a token that
 * is spent. The screen and the background capture both renew, so both must ask
 * here which pair to renew from, or one of them replays what the other spent.
 *
 * Only read or change this while holding the refresh lock.
 */
import type { Connection } from './connectionStore';

/** The process's record of its own renewals. */
export interface TokenLedger {
  /**
   * Picks the pair whose refresh token is still live.
   * @param stored - What storage holds; callers decline rather than guess when it
   *   cannot be read, because the screen's copy can belong to a replaced pairing.
   * @returns The renewal this process made from it, or `stored` itself when
   *   storage holds something this process did not spend — a newer sign-in.
   */
  readonly current: (stored: Connection) => Connection;
  /**
   * Notes that `from` was spent to obtain `issued`, before anything is saved.
   * @param from - The pair whose refresh token was just presented.
   * @param issued - The pair the portal issued in exchange.
   */
  readonly record: (from: Connection, issued: Connection) => void;
  /** Drops every renewal, once the pairing is replaced or removed. */
  readonly forget: () => void;
}

/** The latest pair issued here, and every refresh token spent to reach it. */
interface Chain {
  readonly pair: Connection;
  readonly spent: ReadonlySet<string>;
}

/**
 * Builds an empty ledger.
 * @returns A ledger that knows of no renewals yet.
 */
export function createTokenLedger(): TokenLedger {
  let chain: Chain | null = null;

  return {
    current: (stored) => {
      if (chain?.pair.baseUrl !== stored.baseUrl) return stored;
      const known =
        stored.refreshToken === chain.pair.refreshToken || chain.spent.has(stored.refreshToken);
      return known ? chain.pair : stored;
    },
    record: (from, issued) => {
      const continues =
        chain?.pair.baseUrl === from.baseUrl && chain.pair.refreshToken === from.refreshToken;
      const spent = new Set(continues ? chain?.spent : []);
      spent.add(from.refreshToken);
      chain = { pair: issued, spent };
    },
    forget: () => {
      chain = null;
    },
  };
}

/** The one ledger every renewal in this process shares. */
export const processLedger: TokenLedger = createTokenLedger();
