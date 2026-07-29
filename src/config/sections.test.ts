import type { Manifest, SectionDef } from '../api/manifest';
import { editableSections } from './sections';

const objectSection: SectionDef = {
  key: 'actualBudget',
  label: 'Actual Budget',
  kind: 'object',
  fields: [],
};
const bankMapSection: SectionDef = {
  key: 'banks',
  label: 'Banks',
  kind: 'bankMap',
  bankFields: [],
};
const listSection: SectionDef = { key: 'rules', label: 'Rules', kind: 'list', itemFields: [] };

function manifest(sections: SectionDef[]): Manifest {
  return { sections, banks: [], bankRequirements: {} };
}

describe('editableSections', () => {
  it('keeps object sections', () => {
    expect(editableSections(manifest([objectSection])).map((s) => s.key)).toEqual(['actualBudget']);
  });

  it('drops bankMap sections (edited in the Banks tab)', () => {
    expect(editableSections(manifest([objectSection, bankMapSection])).map((s) => s.key)).toEqual([
      'actualBudget',
    ]);
  });

  it('drops structured list sections (edited in the web portal)', () => {
    expect(editableSections(manifest([objectSection, listSection])).map((s) => s.key)).toEqual([
      'actualBudget',
    ]);
  });

  it('returns an empty list when the manifest has not loaded', () => {
    expect(editableSections(null)).toEqual([]);
  });

  it('preserves the manifest order of the kept sections', () => {
    const another: SectionDef = {
      key: 'notifications',
      label: 'Notifications',
      kind: 'object',
      fields: [],
    };
    expect(
      editableSections(manifest([objectSection, bankMapSection, another])).map((s) => s.key),
    ).toEqual(['actualBudget', 'notifications']);
  });
});
