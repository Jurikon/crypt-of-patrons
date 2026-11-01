# Отчёт бота-балансировщика

Осторожный бот, случайные выборы наград, дверей, покупок и событий. Забегов: 240. Длительность в минутах — оценка по 3 с на ход.

## Победы по классам

| Класс | Усиления Часовни | Побед | Дошли до акта 2 | До акта 3 | Ходов (медиана) | ≈ минут | Застряли |
|---|---|---|---|---|---|---|---|
| knight | нет | 2/40 (5%) | 55% | 28% | 188 | 9 | 3 |
| necromancer | нет | 4/40 (10%) | 48% | 30% | 159 | 8 | 3 |
| rogue | нет | 4/40 (10%) | 65% | 48% | 184 | 9 | 1 |
| knight | все | 15/40 (38%) | 95% | 78% | 285 | 14 | 2 |
| necromancer | все | 18/40 (45%) | 93% | 83% | 212 | 11 | 3 |
| rogue | все | 20/40 (50%) | 98% | 90% | 195 | 10 | 1 |

Цель: без усилений 10–20% побед, со всеми — 40–60%.

## Где умирают

| Акт | Комната 1 | 2 | 3 | 4 | 5 | Босс |
|---|---|---|---|---|---|---|
| 1 | 1 | 4 | 7 | 5 | 9 | 22 |
| 2 | 2 | 4 | 11 | 5 | 7 | 8 |
| 3 | 2 | 2 | 1 | 1 | 3 | 70 |

## Детали в победах и поражениях

Сколько забегов закончилось с этой деталью и какая доля из них — победа. Детали с долей побед заметно выше общей — кандидаты на ослабление; ниже — на усиление. Поправка: чем дольше забег, тем больше в нём деталей, поэтому почти все детали выше общей доли; смотреть стоит на сильные выбросы.

Общая доля побед: 26%.

| Деталь | Забегов с ней | Доля побед | Разница с общей |
|---|---|---|---|
| item.stoneHeart | 61 | 79% | +52 |
| gift.velkar.discharge | 7 | 57% | +31 |
| mod.stunBreaker | 14 | 57% | +31 |
| gift.ashtar.torchbearer | 23 | 57% | +30 |
| mod.hunterMark | 37 | 54% | +28 |
| item.burningLantern | 68 | 51% | +25 |
| mod.trailTraps | 22 | 50% | +24 |
| item.bannerScrap | 40 | 50% | +24 |
| gift.velkar.tailwind | 12 | 50% | +24 |
| mod.markedKill | 18 | 50% | +24 |
| item.pilgrimBoots | 63 | 49% | +23 |
| item.oath | 59 | 49% | +23 |
| item.hourglass | 56 | 48% | +22 |
| item.mirrorDagger | 52 | 48% | +22 |
| mod.vengefulDead | 19 | 47% | +21 |
| mod.bloodyPush | 13 | 46% | +20 |
| gift.ingrid.widowVeil | 22 | 45% | +19 |
| mod.doubleSummon | 22 | 45% | +19 |
| mod.scavenger | 36 | 44% | +18 |
| item.judgeEye | 36 | 44% | +18 |
| item.shadowCloak | 61 | 44% | +18 |
| mod.venomShots | 34 | 44% | +18 |
| mod.throughStrike | 48 | 44% | +18 |
| mod.iceStep | 28 | 43% | +17 |
| item.piggySkull | 63 | 43% | +17 |
| mod.fireTrail | 31 | 42% | +16 |
| mod.explodingSummons | 24 | 42% | +15 |
| mod.bloodForBlood | 46 | 41% | +15 |
| rogue.smoke | 34 | 41% | +15 |
| rogue.swap | 39 | 41% | +15 |
| item.deadBell | 61 | 41% | +15 |
| mod.shadowAfterShadow | 35 | 40% | +14 |
| mod.heavyPushes | 15 | 40% | +14 |
| mod.boneShards | 25 | 40% | +14 |
| gift.ingrid.coldTrail | 5 | 40% | +14 |
| mod.piercing | 25 | 40% | +14 |
| item.rustyNail | 68 | 40% | +13 |
| item.bloodLedger | 65 | 38% | +12 |
| gift.ingrid.iceVerdict | 8 | 38% | +11 |
| necro.curse | 44 | 36% | +10 |
| gift.velkar.stormStep | 11 | 36% | +10 |
| item.lichCrown | 42 | 36% | +9 |
| gift.silas.graveHarvest | 14 | 36% | +9 |
| necro.boneSpear | 48 | 35% | +9 |
| mod.contagion | 23 | 35% | +9 |
| necro.boneWall | 38 | 34% | +8 |
| gift.morra.contagion | 12 | 33% | +7 |
| mod.lastBreath | 27 | 33% | +7 |
| mod.longPush | 9 | 33% | +7 |
| gift.silas.retinue | 15 | 33% | +7 |
| gift.silas.legion | 6 | 33% | +7 |
| mod.chainLightning | 28 | 32% | +6 |
| mod.greedyDead | 25 | 32% | +6 |
| knight.dash | 35 | 31% | +5 |
| gift.velkar.staticCharge | 16 | 31% | +5 |
| rogue.poisonBlade | 45 | 31% | +5 |
| knight.challenge | 42 | 31% | +5 |
| item.jailerChains | 26 | 31% | +5 |
| knight.shieldWall | 30 | 30% | +4 |
| gift.velkar.thunderPush | 10 | 30% | +4 |
| rogue.shadowStep | 77 | 30% | +4 |
| gift.ingrid.hoarfrost | 21 | 29% | +2 |
| mod.longReach | 21 | 29% | +2 |
| necro.raise | 80 | 28% | +1 |
| rogue.knife | 40 | 28% | +1 |
| necro.sacrifice | 44 | 27% | +1 |
| gift.ashtar.judgementFire | 15 | 27% | 0 |
| knight.shieldBash | 84 | 23% | -4 |
| gift.morra.plagueStrike | 18 | 22% | -4 |
| gift.morra.pestilence | 19 | 21% | -5 |
| gift.ashtar.pyre | 21 | 19% | -7 |
| knight.crush | 39 | 13% | -13 |

## Абсурдные билды

- Комната с 3+ врагами за 2 хода и меньше: 1
- Урон по одной цели за одно действие больше 10: 4
- Цепочка срабатываний упёрлась в лимит: 0

| Что | Сид | Класс | Акт/комната | Подробно | Билд |
|---|---|---|---|---|---|
| bigHit | 18 | necromancer | 3/4 | 12 | necro.raise, necro.boneSpear, necro.curse, mod.markedKill, mod.trailTraps, item.stoneHeart, item.burningLantern, item.judgeEye, item.oath, item.mirrorDagger, item.pilgrimBoots, gift.silas.legion, gift.velkar.staticCharge |
| bigHit | 3 | necromancer | 3/6 | 11 | necro.raise, necro.curse, necro.boneSpear, necro.sacrifice, mod.venomShots, mod.greedyDead, mod.scavenger, mod.contagion, item.burningLantern, item.oath, item.shadowCloak, item.bannerScrap, item.rustyNail, gift.velkar.tailwind, gift.velkar.discharge |
| bigHit | 17 | necromancer | 3/6 | 11 | necro.raise, necro.curse, necro.boneSpear, necro.sacrifice, mod.venomShots, mod.bloodForBlood, mod.explodingSummons, mod.throughStrike, item.bannerScrap, item.oath, item.shadowCloak, item.stoneHeart, gift.velkar.staticCharge, gift.ingrid.widowVeil |
| fastRoom | 22 | necromancer | 2/5 | 7 enemies in 1 turns | necro.raise, necro.boneWall, necro.curse, rogue.swap, mod.vengefulDead, mod.hunterMark, mod.iceStep, item.pilgrimBoots, item.deadBell, item.stoneHeart, gift.velkar.discharge, gift.ingrid.widowVeil |
| bigHit | 30 | necromancer | 3/6 | 11 | necro.raise, necro.curse, necro.boneSpear, knight.shieldBash, mod.scavenger, mod.throughStrike, mod.venomShots, mod.longReach, item.stoneHeart, item.deadBell, item.shadowCloak, item.pilgrimBoots, item.bloodLedger, gift.silas.retinue |

## Золото

- Добыто за забег (медиана): 120, потрачено: 20
- Забегов, где встретился торговец: 67%

## События

| Событие#вариант | Раз выбрано |
|---|---|
| bargainAltar#0 | 22 |
| bargainAltar#1 | 20 |
| bell#0 | 8 |
| bell#1 | 5 |
| bloodWell#0 | 20 |
| bloodWell#1 | 27 |
| deadMensDice#0 | 17 |
| deadMensDice#1 | 22 |
| mirror#0 | 14 |
| mirror#1 | 13 |
| mycelium#0 | 7 |
| mycelium#1 | 9 |
| sleepingSarcophagus#0 | 6 |
| sleepingSarcophagus#1 | 8 |
| woundedPilgrim#0 | 8 |
| woundedPilgrim#1 | 14 |
| woundedPilgrim#2 | 13 |

