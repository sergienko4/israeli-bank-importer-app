import type { FieldDef } from '../api/manifest';
import { isFieldVisible } from './visibility';

const base: FieldDef = { key: 'deepPath', label: 'Deep path', kind: 'string' };

describe('isFieldVisible', () => {
  it('is visible when there is no showWhen rule', () => {
    expect(isFieldVisible(base, {})).toBe(true);
  });

  it('is visible when the sibling value matches the rule', () => {
    const field: FieldDef = { ...base, showWhen: { field: 'mode', in: ['thorough'] } };
    expect(isFieldVisible(field, { mode: 'thorough' })).toBe(true);
  });

  it('is hidden when the sibling value does not match', () => {
    const field: FieldDef = { ...base, showWhen: { field: 'mode', in: ['thorough'] } };
    expect(isFieldVisible(field, { mode: 'fast' })).toBe(false);
  });

  it('is hidden when the sibling value is absent', () => {
    const field: FieldDef = { ...base, showWhen: { field: 'mode', in: ['thorough'] } };
    expect(isFieldVisible(field, {})).toBe(false);
  });
});
