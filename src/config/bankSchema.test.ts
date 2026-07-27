import type { BankRequirement, FieldDef, SectionDef } from '../api/manifest';
import { addableFields, allowedFieldKeys, schemaFields } from './bankSchema';

const catalog: FieldDef[] = [
  { key: 'username', label: 'Username', kind: 'string' },
  { key: 'password', label: 'Password', kind: 'secret' },
  { key: 'nationalId', label: 'National ID', kind: 'string' },
  { key: 'card6Digits', label: 'Card last 6 digits', kind: 'string' },
];

const section: SectionDef = {
  key: 'banks', label: 'Banks', kind: 'bankMap', bankFields: catalog,
};

describe('bank schema scoping', () => {
  it('never offers another bank\'s fields (regression: global-catalog leak)', () => {
    // A bank that logs in with username + password must not be offered a
    // card-number field that belongs to a different bank.
    const requirement: BankRequirement = { required: ['username', 'password'] };
    const bank = { username: '', password: '' };

    const addable = addableFields(section, requirement, bank).map((f) => f.key);

    expect(addable).toEqual([]);
    expect(addable).not.toContain('card6Digits');
    expect(addable).not.toContain('nationalId');
  });

  it('offers a bank\'s own advertised optional fields', () => {
    const requirement: BankRequirement = { required: ['username', 'password'], optional: ['nationalId'] };
    const bank = { username: '', password: '' };

    expect(addableFields(section, requirement, bank).map((f) => f.key)).toEqual(['nationalId']);
  });

  it('does not re-offer an optional field already present on the bank', () => {
    const requirement: BankRequirement = { required: ['username'], optional: ['nationalId'] };
    const bank = { username: 'x', nationalId: '123' };

    expect(addableFields(section, requirement, bank)).toEqual([]);
  });

  it('falls back to required-only for an unknown bank (no requirement advertised)', () => {
    expect(schemaFields(section, undefined)).toEqual([]);
    expect(addableFields(section, undefined, {})).toEqual([]);
  });

  it('offers nothing to add once a no-optionals bank is seeded with its required fields', () => {
    const requirement: BankRequirement = { required: ['username', 'password'] };
    const bank = { username: '', password: '' };

    expect(addableFields(section, requirement, bank)).toEqual([]);
  });

  it('unions required and optional keys into the allowed set', () => {
    const requirement: BankRequirement = { required: ['a'], optional: ['b', 'c'] };

    expect([...allowedFieldKeys(requirement)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('preserves the catalog order of a bank\'s schema fields', () => {
    const requirement: BankRequirement = { required: ['password'], optional: ['username', 'nationalId'] };

    expect(schemaFields(section, requirement).map((f) => f.key)).toEqual(['username', 'password', 'nationalId']);
  });
});
