import { bannerAnnouncement } from './Banner';

describe('bannerAnnouncement', () => {
  it('announces joined danger messages by default', () => {
    expect(bannerAnnouncement(['First', 'Second'], 'danger', true)).toBe('First. Second');
  });

  it('stays silent when the caller already announces the same text', () => {
    expect(bannerAnnouncement(['Code is invalid'], 'danger', false)).toBeNull();
  });

  it('stays silent for info banners', () => {
    expect(bannerAnnouncement(['Saved'], 'info', true)).toBeNull();
  });

  it('stays silent when there is nothing to announce', () => {
    expect(bannerAnnouncement([], 'danger', true)).toBeNull();
  });
});
