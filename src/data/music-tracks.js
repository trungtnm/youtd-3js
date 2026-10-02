// Background music. All tracks are by Kevin MacLeod (incompetech.com), licensed
// under CC BY 4.0. Files were re-encoded to 128 kbps MP3 for size; no other changes.
// Full credits: docs/music-credits.md

const CC_BY_4 = 'CC BY 4.0';
const CC_BY_4_URL = 'https://creativecommons.org/licenses/by/4.0/';

export const MUSIC_TRACKS = [
  {
    id: 'lasting-hope',
    title: 'Lasting Hope',
    artist: 'Kevin MacLeod',
    file: '/music/lasting-hope.mp3',
    mood: 'calm',
    license: CC_BY_4,
    licenseUrl: CC_BY_4_URL,
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100178',
  },
  {
    id: 'lightless-dawn',
    title: 'Lightless Dawn',
    artist: 'Kevin MacLeod',
    file: '/music/lightless-dawn.mp3',
    mood: 'calm',
    license: CC_BY_4,
    licenseUrl: CC_BY_4_URL,
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100655',
  },
  {
    id: 'rocket',
    title: 'Rocket',
    artist: 'Kevin MacLeod',
    file: '/music/rocket.mp3',
    mood: 'battle',
    license: CC_BY_4,
    licenseUrl: CC_BY_4_URL,
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100568',
  },
  {
    id: 'darkness-is-coming',
    title: 'Darkness is Coming',
    artist: 'Kevin MacLeod',
    file: '/music/darkness-is-coming.mp3',
    mood: 'battle',
    license: CC_BY_4,
    licenseUrl: CC_BY_4_URL,
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100584',
  },
  {
    id: 'exit-the-premises',
    title: 'Exit the Premises',
    artist: 'Kevin MacLeod',
    file: '/music/exit-the-premises.mp3',
    mood: 'battle',
    license: CC_BY_4,
    licenseUrl: CC_BY_4_URL,
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500029',
  },
  {
    id: 'final-battle-of-the-dark-wizards',
    title: 'Final Battle of the Dark Wizards',
    artist: 'Kevin MacLeod',
    file: '/music/final-battle-of-the-dark-wizards.mp3',
    mood: 'boss',
    license: CC_BY_4,
    licenseUrl: CC_BY_4_URL,
    source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500085',
  },
];

// Attribution wording follows incompetech's "Attribution Code" format.
export const MUSIC_CREDITS_TEXT = MUSIC_TRACKS.map(
  (t) => `"${t.title}" ${t.artist} (incompetech.com) — Licensed under Creative Commons: By Attribution 4.0 License ${t.licenseUrl}`,
).join('\n');
