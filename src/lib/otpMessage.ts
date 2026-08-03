/**
 * Pulls a bank one-time code out of a text message.
 *
 * This is the only place a captured SMS body is ever read. It is a pure
 * function so the body can be turned into digits and dropped in the same
 * breath: it never reaches React state, storage, a log, or the network.
 *
 * The message is attacker-controlled — anyone who knows the phone number can
 * send one — and its output feeds the auto-submit path, where a wrong code
 * spends one of the bank's few attempts. So the rule is deliberately narrow
 * rather than clever: a message yields a code only when it contains exactly one
 * distinct standalone run of 4–8 digits. Anything ambiguous returns null and
 * the user types the code, which costs a few seconds and never an attempt.
 *
 * Notably absent is any keyword requirement ("code", "קוד", "OTP"). Israeli
 * banks word these messages inconsistently and in two scripts, so a keyword
 * list would fail on real messages while adding no protection: the caller
 * already only sees a message the user explicitly handed over.
 */
import { isValidOtpCode } from './otpCode';

/**
 * The longest message body worth scanning. Bank codes arrive in short
 * messages, so anything larger is either not one or is an attempt to make the
 * scan expensive; both are answered the same way.
 */
export const MAX_MESSAGE_LENGTH = 640;

/**
 * Matches maximal runs of ASCII digits.
 *
 * Matching *maximal* runs is what keeps an account number out: `12345678901`
 * is one eleven-digit run, not an embedded six-digit code. Only ASCII digits
 * count, so look-alike digits from other scripts act as separators and cannot
 * smuggle a code past {@link isValidOtpCode}.
 */
const DIGIT_RUN_RE = /\d+/gu;

/**
 * Extracts the one-time code a message contains, if it unambiguously has one.
 * @param body - The raw message text, as captured from the OS.
 * @returns The code to submit, or null when the message is empty, oversized, or ambiguous.
 */
export function extractOtpCode(body: string): string | null {
  if (body.length > MAX_MESSAGE_LENGTH) {
    return null;
  }
  const candidates = new Set((body.match(DIGIT_RUN_RE) ?? []).filter((run) => isValidOtpCode(run)));
  if (candidates.size !== 1) {
    return null;
  }
  const [code] = candidates;
  return code;
}
