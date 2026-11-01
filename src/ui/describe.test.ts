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
import { describeAbility, describeRule, describeStatus, describeSurface, glossary } from './describe';

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
        ...STATUSES.map(describeStatus),
        ...SURFACES.map(describeSurface),
        ...[...ABILITIES, ...MODIFIERS, ...ITEMS, ...GIFTS].flatMap((x) =>
          glossary(x).map((g) => `${g.name}: ${g.text}`),
        ),
      ];
      for (const text of texts) expect(text, text).not.toMatch(RAW);
      setLang('en');
    });

  it('every status a card mentions is explained (owner: "what is a curse?")', () => {
    setLang('ru');
    const curse = ABILITIES.find((a) => a.id === 'necro.curse')!;
    const g = glossary(curse);
    expect(g.map((x) => x.name)).toEqual(['💀 Проклятие']);
    expect(g[0]!.text).toMatch(/урона/);
    setLang('en');
  });

  it('Static charge reads as "every 3rd time" (owner: the old text was unclear)', () => {
    setLang('ru');
    const text = describeRule(GIFTS.find((x) => x.id === 'gift.velkar.staticCharge')!);
    expect(text).toBe('Когда ты бьёшь (базовая атака), каждый 3-й раз: Оглушение на 1 х.');
    setLang('en');
  });
});
