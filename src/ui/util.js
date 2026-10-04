// Small DOM helpers shared by the HUD and the profile screens.

import { RARITIES } from '../data/constants.js';

// Escapes text for safe use inside HTML built with template strings.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Element-tinted tower glyph (SVG used as a CSS mask so currentColor applies).
export const towerIcon = (icon, size = '') => `<span class="ico ${size}" style="--icon:url('${icon}')"></span>`;

// Item glyphs are tinted by rarity and sized relative to the surrounding font.
export const itemIcon = (d) => `<span class="ico item" style="--icon:url('${d.icon}');color:${RARITIES[d.rarity].css}"></span>`;
