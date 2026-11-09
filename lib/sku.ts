export type UnitKey = "gember" | "appel" | "granaat" | "shot" | "onderzetter";

export type Units = Record<UnitKey, number>;

export type SkuRule = { kind: "units"; units: Units } | { kind: "ignore" } | { kind: "unknown" };

export function emptyUnits(): Units {
  return { gember: 0, appel: 0, granaat: 0, shot: 0, onderzetter: 0 };
}

function bottles(partial: Partial<Units>): SkuRule {
  return { kind: "units", units: { ...emptyUnits(), ...partial } };
}

const IGNORE: SkuRule = { kind: "ignore" };

/**
 * Bottle composition per SKU. SKU digits are not trusted:
 * Gember1 is 3 bottles, Gember32 is 16, Gember8 is 5+3 (8 bottles of gember).
 * Combo splits follow the shop composition, which also matches virtual OPSLAG
 * and the portion counts (gember 12, appel and granaatappel 3 per bottle).
 */
const SKUS: Record<string, SkuRule> = {
  gember: bottles({ gember: 1 }),
  gember1: bottles({ gember: 3 }),
  gember2: bottles({ gember: 2 }),
  gember3: bottles({ gember: 3 }),
  gember4: bottles({ gember: 4 }),
  gember5: bottles({ gember: 5 }),
  gember6: bottles({ gember: 6 }),
  gember7: bottles({ gember: 7 }),
  gember8: bottles({ gember: 8 }),
  "gember8-2": bottles({ gember: 8 }),
  gember9: bottles({ gember: 9 }),
  gember12: bottles({ gember: 12 }),
  gember15: bottles({ gember: 15 }),
  gember32: bottles({ gember: 16 }),
  gratis5: bottles({ gember: 5 }),

  appelgember1: bottles({ appel: 1 }),
  appelgember5: bottles({ appel: 5 }),
  appelgember10: bottles({ appel: 10 }),
  appelgember15: bottles({ appel: 15 }),
  appelgember19: bottles({ appel: 19 }),
  appelgember20: bottles({ appel: 20 }),
  "appelgember20-2": bottles({ appel: 20 }),
  "appelgember20-3": bottles({ appel: 20 }),
  appelgember40: bottles({ appel: 40 }),

  granaatappel1: bottles({ granaat: 1 }),
  granaatappel5: bottles({ granaat: 5 }),
  granaatappel10: bottles({ granaat: 10 }),
  granaatappel15: bottles({ granaat: 15 }),
  granaatappel19: bottles({ granaat: 19 }),
  granaatappel20: bottles({ granaat: 20 }),
  granaatappel40: bottles({ granaat: 40 }),

  "combi2+5": bottles({ gember: 2, appel: 5 }),
  "combi3+10": bottles({ gember: 3, appel: 10 }),
  "combi4+20": bottles({ gember: 4, appel: 20 }),
  gegrac13: bottles({ gember: 3, granaat: 5, appel: 5 }),
  gegrac20: bottles({ gember: 4, granaat: 8, appel: 8 }),

  shotglaasje: bottles({ shot: 1 }),
  "shotglaasje-2": bottles({ shot: 2 }),
  shotglaasje2x: bottles({ shot: 2 }),
  shotglaasje4: bottles({ shot: 4 }),
  shotglaasje4x: bottles({ shot: 4 }),
  shotglaasje6x: bottles({ shot: 6 }),

  onderzetter: bottles({ onderzetter: 1 }),

  // Shipping service, not a physical product.
  "123": IGNORE,
  box6: IGNORE,
  box12: IGNORE,
  box30: IGNORE,
  box48: IGNORE,
  seperator6: IGNORE,
  seperator12: IGNORE,
  seperator30: IGNORE,
  seperator48: IGNORE,
  tape: IGNORE,
};

export function classifySku(sku: string): SkuRule {
  return SKUS[sku.trim().toLowerCase()] ?? { kind: "unknown" };
}

export function bottleCount(units: Units): number {
  return units.gember + units.appel + units.granaat;
}

export function addUnits(target: Units, extra: Units, quantity: number): void {
  (Object.keys(target) as UnitKey[]).forEach((key) => {
    target[key] += extra[key] * quantity;
  });
}
