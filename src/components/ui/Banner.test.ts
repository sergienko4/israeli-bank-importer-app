import { bannerAnnouncement } from './Banner';

describe('bannerAnnouncement', () => {
  it('announces joined danger messages by default', () => {
    expect(bannerAnnouncement(['First', 'Second'], 'danger', undefined)).toBe('First. Second');
  });

  it('announces a caller-provided override', () => {
    expect(bannerAnnouncement(['First', 'Second'], 'danger', 'Code is invalid')).toBe(
      'Code is invalid',
    );
  });

  it('stays silent when the caller already announces the same text', () => {
    expect(bannerAnnouncement(['Code is invalid'], 'danger', null)).toBeNull();
  });

  it('stays silent for info banners', () => {
    expect(bannerAnnouncement(['Saved'], 'info', undefined)).toBeNull();
  });

  it('stays silent when there is nothing to announce', () => {
    expect(bannerAnnouncement([], 'danger', undefined)).toBeNull();
  });
});
