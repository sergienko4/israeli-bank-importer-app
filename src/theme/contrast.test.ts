import { contrastRatio, relativeLuminance } from './contrast';

describe('relativeLuminance', () => {
  it('returns 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('accepts lowercase hex', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('rejects a colour form it cannot check', () => {
    expect(() => relativeLuminance('rgba(15, 31, 24, 0.45)')).toThrow('Expected a #RRGGBB colour');
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0B7C57', '#0B7C57')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0B7C57', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#0B7C57'), 5);
  });

  it('matches the known ratio of the brand green on white', () => {
    expect(contrastRatio('#0B7C57', '#FFFFFF')).toBeCloseTo(5.2, 1);
  });
});
