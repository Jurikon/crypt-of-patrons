import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  GIFTS,
  HYBRIDS,
  ITEMS,
  MODIFIERS,
  PASSIVES,
  PATRONS,
  STATUSES,
  SUMMONS,
  SURFACES,
} from '../content';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import { setLang } from '../i18n';
import { describeAbility, describeRule } from './describe';

const RAW =
  /\b(desc|when|stat|effect|target|tag|status|surface|summon|gift|duo|patron|voice)\.[a-zA-Z.]+|undefined|NaN/;

describe('generated descriptions', () => {
  it('every content name exists in English and Russian', () => {
    const keys = [
      ...ABILITIES.map((a) => a.nameKey),
      ...MODIFIERS.map((m) => m.nameKey),
      ...ITEMS.map((i) => i.nameKey),
      ...PASSIVES.map((p) => p.nameKey),
      ...HYBRIDS.map((h) => h.nameKey),
      ...STATUSES.map((s) => s.nameKey),
      ...SURFACES.map((s) => s.nameKey),
      ...SUMMONS.map((s) => s.nameKey),
      ...GIFTS.map((g) => g.nameKey),
      ...PATRONS.flatMap((p) => [p.nameKey, p.voiceKey]),
    ];
    for (const k of keys) {
      expect(k in en, `en: ${k}`).toBe(true);
      expect(k in ru, `ru: ${k}`).toBe(true);
    }
  });

  for (const lang of ['en', 'ru'] as const)
    it(`descriptions in ${lang} have no untranslated keys`, () => {
      setLang(lang);
      const texts = [
        ...ABILITIES.map(describeAbility),
        ...[...MODIFIERS, ...ITEMS, ...PASSIVES, ...HYBRIDS.map((h) => h.rule), ...GIFTS].map(describeRule),
      ];
      for (const text of texts) expect(text, text).not.toMatch(RAW);
      setLang('en');
    });
});
