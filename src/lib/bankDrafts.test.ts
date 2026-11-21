import { discardBankDraft, isNewBankDraft, targetsLabel } from './bankDrafts';

describe('isNewBankDraft', () => {
  it('is true when the saved config has no such bank', () => {
    expect(isNewBankDraft({ banks: { leumi: { username: 'saved' } } }, 'hapoalim')).toBe(true);
  });

  it('is false when the saved config already has the bank', () => {
    expect(isNewBankDraft({ banks: { leumi: { username: 'saved' } } }, 'leumi')).toBe(false);
  });

  it('handles a config with no banks key', () => {
    expect(isNewBankDraft({}, 'leumi')).toBe(true);
  });
});

describe('targetsLabel', () => {
  it('uses the singular for one target', () => {
    expect(targetsLabel(1)).toBe('1 target');
  });

  it('uses the plural for zero and many', () => {
    expect(targetsLabel(0)).toBe('0 targets');
    expect(targetsLabel(3)).toBe('3 targets');
  });
});

describe('discardBankDraft', () => {
  it('removes a newly added bank from the draft', () => {
    const baseline = { banks: { leumi: { username: 'saved' } } };
    const draft = {
      banks: { leumi: { username: 'saved' }, hapoalim: { username: 'typed' } },
    };

    expect(discardBankDraft(baseline, draft, 'hapoalim')).toEqual(baseline);
  });

  it('restores an edited bank from the saved config', () => {
    const baseline = { banks: { leumi: { username: 'saved', targets: [{}] } } };
    const draft = { banks: { leumi: { username: 'edited', targets: [{}] } } };

    expect(discardBankDraft(baseline, draft, 'leumi')).toEqual(baseline);
  });

  it('leaves every other bank alone', () => {
    const baseline = { banks: { leumi: { username: 'saved' } } };
    const draft = {
      banks: {
        leumi: { username: 'edited' },
        hapoalim: { username: 'typed' },
        discount: { username: 'other' },
      },
    };

    expect(discardBankDraft(baseline, draft, 'leumi')).toEqual({
      banks: {
        leumi: { username: 'saved' },
        hapoalim: { username: 'typed' },
        discount: { username: 'other' },
      },
    });
  });

  it('does not mutate the draft it is given', () => {
    const baseline = { banks: { leumi: { username: 'saved' } } };
    const draft = { banks: { leumi: { username: 'edited' } } };

    discardBankDraft(baseline, draft, 'leumi');

    expect(draft.banks.leumi).toEqual({ username: 'edited' });
  });

  it('returns the draft unchanged when the id is in neither config', () => {
    const baseline = { banks: {} };
    const draft = { banks: {} };

    expect(discardBankDraft(baseline, draft, 'leumi')).toBe(draft);
  });

  it('adds the banks container when the draft had none', () => {
    const baseline = { banks: { leumi: { username: 'saved' } } };

    expect(discardBankDraft(baseline, {}, 'leumi')).toEqual(baseline);
  });
});
