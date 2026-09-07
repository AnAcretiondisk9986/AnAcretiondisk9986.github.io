/** Original line artwork shared by server-rendered controls and dynamic players. */
export const iconPaths = {
  'arrow-right': 'M4 12h15m-6-6 6 6-6 6',
  'arrow-up-right': 'M6 18 18 6M6 6h12v12',
  'arrow-left': 'M20 12H5m6-6-6 6 6 6',
  'arrow-up': 'M12 20V5m-6 6 6-6 6 6',
  'arrow-down': 'M12 4v15m-6-6 6 6 6-6',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  rows: 'M4 5h3v3H4zM11 6.5h9M4 11h3v3H4zM11 12.5h9M4 17h3v3H4zM11 18.5h9',
  close: 'm6 6 12 12M6 18 18 6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20.5 14A8.7 8.7 0 0 1 10 3.5 8.7 8.7 0 1 0 20.5 14Z',
  aperture: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 4l4 8m8-5-8 5m6 7-6-7m-8 5 8-5M8 20l4-8',
  play: 'M8 5v14l11-7Z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  volume: 'M4 10v4h3l5 4V6l-5 4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  'volume-off': 'M4 10v4h3l5 4V6l-5 4H4zM17 9l4 6m0-6-4 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 21h16',
  copy: 'M9 8h11v13H9zM15 8V3H4v13h5',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3',
} as const;
export type IconName = keyof typeof iconPaths;

/** Only fixed, trusted path data is serialized, never user content. */
export function iconMarkup(name: IconName): string {
  return `<svg class="ui-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${iconPaths[name]}"/></svg>`;
}
