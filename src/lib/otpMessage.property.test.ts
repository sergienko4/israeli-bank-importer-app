/**
 * Property-based tests for the SMS one-time-code extractor.
 *
 * The examples beside this file cover the messages we thought of. These
 * properties cover the ones we did not: the extractor is fed a text message, so
 * it must be total and its answer must always be safe to submit.
 */
import * as fc from 'fast-check';

import { isValidOtpCode } from './otpCode';
import { extractOtpCode } from './otpMessage';

describe('extractOtpCode properties', () => {
  it('is total: no string makes it throw', () => {
    fc.assert(
      fc.property(fc.string(), (body) => {
        expect(() => extractOtpCode(body)).not.toThrow();
      }),
    );
  });

  it('never returns something the importer would reject', () => {
    fc.assert(
      fc.property(fc.string(), (body) => {
        const code = extractOtpCode(body);
        expect(code === null || isValidOtpCode(code)).toBe(true);
      }),
    );
  });

  it('never returns a code the message does not literally contain', () => {
    fc.assert(
      fc.property(fc.string(), (body) => {
        const code = extractOtpCode(body);
        expect(code === null || body.includes(code)).toBe(true);
      }),
    );
  });

  it('finds a lone code however the message is padded with letters', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[ A-Za-z]{0,40}$/),
        fc.stringMatching(/^[ A-Za-z]{0,40}$/),
        fc.stringMatching(/^\d{4,8}$/),
        (before, after, code) => {
          expect(extractOtpCode(`${before} ${code} ${after}`)).toBe(code);
        },
      ),
    );
  });

  it('refuses any message carrying two different codes', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\d{4,8}$/),
        fc.stringMatching(/^\d{4,8}$/),
        (first, second) => {
          fc.pre(first !== second);
          expect(extractOtpCode(`code ${first} or ${second}`)).toBeNull();
        },
      ),
    );
  });
});
