import { parseNumberFieldText } from './FieldInput';

describe('parseNumberFieldText', () => {
  it('returns undefined for an empty numeric input', () => {
    expect(parseNumberFieldText('   ')).toEqual({ kind: 'valid', value: undefined });
  });

  it('returns a finite number for valid numeric input', () => {
    expect(parseNumberFieldText('42.5')).toEqual({ kind: 'valid', value: 42.5 });
  });

  it('marks non-numeric input as invalid so callers do not emit it', () => {
    expect(parseNumberFieldText('not-a-number')).toEqual({ kind: 'invalid' });
  });

  it('marks infinite input as invalid so saved config never receives NaN-like values', () => {
    expect(parseNumberFieldText('Infinity')).toEqual({ kind: 'invalid' });
  });
});
