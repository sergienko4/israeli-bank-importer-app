import { parseNumberFieldText } from './FieldInput';

describe('parseNumberFieldText', () => {
  it('returns undefined for an empty numeric input', () => {
    expect(parseNumberFieldText('   ')).toEqual({ kind: 'valid', value: undefined });
  });

  it('returns a finite number for valid numeric input', () => {
    expect(parseNumberFieldText('42.5')).toEqual({ kind: 'valid', value: 42.5 });
  });

  it('accepts a comma decimal separator', () => {
    expect(parseNumberFieldText('42,5')).toEqual({ kind: 'valid', value: 42.5 });
    expect(parseNumberFieldText('12,34')).toEqual({ kind: 'valid', value: 12.34 });
  });

  it('does not read a grouped thousand as a decimal', () => {
    expect(parseNumberFieldText('1,000')).toEqual({ kind: 'invalid' });
    expect(parseNumberFieldText('1,234.56')).toEqual({ kind: 'invalid' });
  });

  it('rejects hex, exponents, and multiple separators', () => {
    expect(parseNumberFieldText('0x10')).toEqual({ kind: 'invalid' });
    expect(parseNumberFieldText('1e3')).toEqual({ kind: 'invalid' });
    expect(parseNumberFieldText('1.2.3')).toEqual({ kind: 'invalid' });
  });

  it('accepts intermediate text while the user types', () => {
    expect(parseNumberFieldText('42.')).toEqual({ kind: 'valid', value: 42 });
    expect(parseNumberFieldText('-')).toEqual({ kind: 'invalid' });
    expect(parseNumberFieldText('-5')).toEqual({ kind: 'valid', value: -5 });
  });

  it('marks non-numeric input as invalid so callers do not emit it', () => {
    expect(parseNumberFieldText('not-a-number')).toEqual({ kind: 'invalid' });
  });

  it('marks infinite input as invalid so saved config never receives NaN-like values', () => {
    expect(parseNumberFieldText('Infinity')).toEqual({ kind: 'invalid' });
  });
});
