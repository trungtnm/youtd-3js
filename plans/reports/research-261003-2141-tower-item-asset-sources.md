# Concept-accurate icons and models for towers and items

Researched 2026-10-03.

## Tóm tắt tiếng Việt

1. Hiện tại 690 tower (235 họ) dùng chung 35 icon và 34 model thủ tục. Mỗi họ được gán ngẫu nhiên theo hash số họ trong cùng nguyên tố (`src/data/towers.js`), nên Forest Troll không ra troll. 315 item dùng chung 18 emoji, chọn theo chỉ số mạnh nhất (`src/data/items.js`).
2. Icon tower nhanh nhất là chọn tay từ game-icons.net (CC BY 3.0, đang dùng sẵn, hơn 4.200 icon). Khớp từ khóa tìm được ứng viên cho 217/235 họ và 274/315 item. Có sẵn `skoll/troll`, `delapouite/ogre`, `polar-bear`, `igloo`, `minigun`, `kraken-tentacle` và nhiều icon khác.
3. Model 3D: không gói CC0 nào có troll. Quaternius và KayKit (CC0) phủ khoảng 50–60 khái niệm (orc, goblin, yeti, dragon, demon, wizard, skeleton, knight, các công trình).
4. Các sinh vật còn thiếu (troll, kraken, gryphon, harpy, phoenix, golem, spider queen) cần AI image→3D: Meshy (gói free là CC BY 4.0) hoặc TRELLIS (MIT, chạy local). Sau đó giảm còn khoảng 2–5k tam giác.
5. Khi đã có model, render chính model đó ra icon PNG lúc build để icon luôn khớp model. Synty, Raven Fantasy Icons bản trả phí và Tripo bản free không dùng được cho repo công khai.

## Current state

| Asset | Count | Distinct | How it is assigned |
|---|---|---|---|
| Tower icons | 690 towers, 235 families | 35 | `pickBy(ICON_KEYS[element], familyNumber)` hash in `src/data/towers.js` |
| Tower models | 690 towers, 235 families | 34 | `pickBy(MODELS[element], familyNumber)`, procedural in `src/world/models.js` |
| Item icons | 315 items | 18 emoji | Strongest stat line, `iconFor` in `src/data/items.js` |

Family names are concrete: Forest Troll, Cold Troll, Polar Bear Cub, Spider Queen, Gryphon Rider, Lich King, Kraken, Gatling Gun, Igloo, Zeus. The hash ignores the name, so icons and models feel random.

## Icons: game-icons.net coverage (checked locally)

I cloned github.com/game-icons/icons (4,239 SVGs) and matched each family's tier-1 name and each item name against icon file names with a synonym table.

- Tower families: 217 of 235 have at least one candidate. See `research-261003-2141-family-icon-candidates.txt`.
- Items: 274 of 315 have at least one candidate. See `research-261003-2141-item-icon-candidates.txt`.
- Most misses are synonym gaps, not missing concepts. Examples: Little Phoenix, Shaman, Excalibur (`lorc/sword-in-stone` exists), Greyfang (wolf).
- The first candidate is often wrong. "Forest Troll" lists `forest` before `troll`, for example. So the mapping must be curated by hand, not auto-picked.

Verdict: this is the cheapest, license-safe step with the biggest gain. It needs no new license, since the credits file and in-game Credits already cover game-icons.net. The style stays monochrome, tinted by element.

## 3D model sources

| Source | License | Count | Coverage | Verdict |
|---|---|---|---|---|
| [Quaternius Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html) | CC0 | 50, animated, glTF | Orc, goblin, yeti, dragon, demon, wizard, ghost, skull, mushroom king | Best creature source |
| [Quaternius Ultimate Fantasy RTS](https://quaternius.com/packs/ultimatefantasyrts.html) | CC0 | 128 | Buildings in upgrade stages: stronghold, watchtower, obelisk-like | Best structure source; stages could map to tiers |
| [Quaternius RPG Character Pack](https://quaternius.com/packs/rpgcharacters.html) | CC0 | 6, rigged | Human heroes | Marine, Sniper, Priest-style towers |
| [KayKit Adventurers / Skeletons / Dungeon](https://kaylousberg.itch.io/) | CC0 (free tiers) | 5 + 4 + 200 props | Knight, mage, ranger, skeletons; necromancer only in the paid tier | Good, same low-poly style |
| [Kenney Tower Defense Kit](https://kenney.nl/assets/tower-defense-kit) and other 3D kits | CC0 | 160 files | Generic towers, graveyard props | Structures only |
| [Poly Pizza](https://poly.pizza/) | Per model (CC0 or CC-BY) | 10,700+ GLB | Ogre and golem by third parties | Discovery tool; verify each model's license |
| Sketchfab | Per model | Large | Anything, uneven quality | Hand-pick only; bulk API download needs end-user OAuth |
| Synty | Paid EULA forbids sharing source files | — | — | Unusable in a public repo |

No CC0 pack has a troll. Pack models cover roughly 50–60 of the 235 families.

## AI generation for missing concepts

| Option | Output rights | Notes |
|---|---|---|
| [Meshy](https://www.meshy.ai/pricing) | Free plan: CC BY 4.0. Pro: full ownership. | GLB with configurable polycount. Recommended. |
| TRELLIS | MIT, runs locally | Needs an NVIDIA GPU with at least 16 GB |
| Tripo | Free tier reported as non-commercial | Paid plan only, after reading the terms |
| Rodin / Hyper3D | Paid downloads | Higher cost per model |
| Hunyuan3D 2 | Tencent license excludes EU, UK and South Korea | Risky for an open-source repo |
| Higgsfield `generate_3d` (connected here) | Terms not verified | Check its terms before use |

Budget: 2,000–5,000 triangles and a 256–512 px texture per tower, via the generator's polycount setting or `gltf-transform simplify` and `resize`. Flat-shaded, vertex-coloured output matches Quaternius best.

## Painted item icon packs

No permissive painted pack I could verify covers 315 WC3-style items. The free CC-BY packs on OpenGameArt hold only 30–37 icons each. Shikashi's pack (CC BY 4.0) is 32 px pixel art and clashes with the HUD. The paid Raven Fantasy Icons license does not allow redistribution in a public repo. For items, curated game-icons.net glyphs tinted by rarity, or rendered prop models, are the realistic options.

## Recommended path

1. **Phase 1: curated icons (small, license-safe).** Add a `TOWER_ICON_BY_FAMILY` map (family name to game-icons SVG) and an item icon map. Copy only the chosen SVGs into `public/icons/` with the existing `currentColor` edit, and extend `docs/icon-credits.md` and the in-game Credits. Keep the current hash pick as the fallback. Forest Troll gets `skoll/troll`.
2. **Phase 2: archetype models.** Add a GLB loader path in `src/world/models.js` that maps a family to a model file, keeping procedural models as the fallback. Start with the CC0 Quaternius and KayKit creatures and structures that match by name, tinted per element and scaled per tier.
3. **Phase 3: bespoke creatures.** Generate the named creatures no pack covers (troll, kraken, gryphon, harpy, phoenix, golem, spider queen, sea turtle, polar bear and others) with Meshy or TRELLIS, then decimate and credit them.
4. **Phase 4 (optional): rendered icons.** Once a family has a model, render its icon from the model at build time, so icon and model match. This replaces the glyph for that family.

## Not verified

- Per-model licenses on Poly Pizza (ogre, golem), and the Quaternius QAL terms for the Bestiary pack.
- Tripo's and Higgsfield's official output terms; the price of Meshy Pro.
- Exact contents and polycounts of the Quaternius and Kenney packs not opened.
