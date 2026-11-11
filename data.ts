// Demonstration dataset. Statuses summarise publicly known positions and are
// NOT legal advice. Always verify against the official EU / FDA sources.
export type Status = "approved" | "restricted" | "banned";
export type Market = "EU" | "US";

export interface Seed {
  name: string;
  e?: string;
  category: string;
  aliases: string[];
  rules: Record<Market, [Status, string]>;
  subs: string[];
}

export const MARKETS: Market[] = ["EU", "US"];

export const SEED: Seed[] = [
  { name: "Titanium dioxide", e: "E171", category: "Colour", aliases: ["tio2", "titanium white"],
    rules: { EU: ["banned", "No longer authorised as a food additive in the EU (2022)."], US: ["restricted", "Permitted colour additive, limited to 1% of food weight."] },
    subs: ["Calcium carbonate", "Rice starch"] },
  { name: "Potassium bromate", e: "E924", category: "Flour improver", aliases: ["bromated flour"],
    rules: { EU: ["banned", "Not authorised in the EU."], US: ["restricted", "Federally permitted under conditions; some US states restrict or ban it."] },
    subs: ["Ascorbic acid", "Enzyme preparations"] },
  { name: "Azodicarbonamide", e: "E927a", category: "Flour improver", aliases: ["ada"],
    rules: { EU: ["banned", "Not authorised in the EU."], US: ["restricted", "Permitted in flour and dough up to a set limit."] },
    subs: ["Ascorbic acid", "Enzyme preparations"] },
  { name: "Propylparaben", e: "E216", category: "Preservative", aliases: ["propyl paraben"],
    rules: { EU: ["banned", "No longer authorised as a food preservative in the EU."], US: ["approved", "Generally recognised as safe."] },
    subs: ["Potassium sorbate", "Sorbic acid"] },
  { name: "Erythrosine", e: "E127", category: "Colour", aliases: ["red 3", "red no. 3", "fd&c red no. 3", "fdc red 3"],
    rules: { EU: ["restricted", "Authorised only for a few uses such as cocktail and candied cherries."], US: ["banned", "FDA revoked food use in 2025; compliance deadline 15 Jan 2027."] },
    subs: ["Beetroot red", "Anthocyanins"] },
  { name: "Brominated vegetable oil", e: "E443", category: "Emulsifier", aliases: ["bvo"],
    rules: { EU: ["banned", "Not authorised in the EU."], US: ["banned", "FDA revoked authorisation in 2024."] },
    subs: ["Glycerol esters of wood rosin", "Sucrose acetate isobutyrate"] },
  { name: "Tartrazine", e: "E102", category: "Colour", aliases: ["yellow 5", "fd&c yellow no. 5"],
    rules: { EU: ["restricted", "Authorised; label must carry the 'may have an adverse effect on activity and attention in children' warning."], US: ["approved", "Certified colour additive; must be declared on the label."] },
    subs: ["Curcumin", "Beta-carotene"] },
  { name: "Sunset Yellow FCF", e: "E110", category: "Colour", aliases: ["yellow 6", "fd&c yellow no. 6"],
    rules: { EU: ["restricted", "Authorised; requires the children's activity and attention warning on the label."], US: ["approved", "Certified colour additive; must be declared on the label."] },
    subs: ["Paprika extract", "Beta-carotene"] },
  { name: "Allura Red AC", e: "E129", category: "Colour", aliases: ["red 40", "fd&c red no. 40"],
    rules: { EU: ["restricted", "Authorised; requires the children's activity and attention warning on the label."], US: ["approved", "Certified colour additive; must be declared on the label."] },
    subs: ["Beetroot red", "Anthocyanins"] },
  { name: "Sodium nitrite", e: "E250", category: "Preservative", aliases: ["nitrite"],
    rules: { EU: ["restricted", "Authorised for curing with maximum levels."], US: ["restricted", "Authorised for curing with maximum levels."] },
    subs: ["Cultured celery powder (natural nitrite source)"] },
  { name: "Sulphur dioxide", e: "E220", category: "Preservative", aliases: ["sulphites", "sulfites", "sulphite", "sulfur dioxide"],
    rules: { EU: ["restricted", "Maximum levels apply; must be declared as an allergen above 10 mg/kg."], US: ["restricted", "Must be declared when 10 ppm or more."] },
    subs: ["Ascorbic acid"] },
  { name: "Butylated hydroxyanisole", e: "E320", category: "Antioxidant", aliases: ["bha"],
    rules: { EU: ["restricted", "Authorised with maximum levels."], US: ["restricted", "Permitted up to a limit relative to fat content."] },
    subs: ["Rosemary extract", "Tocopherols"] },
  { name: "Sodium benzoate", e: "E211", category: "Preservative", aliases: ["benzoate of soda"],
    rules: { EU: ["restricted", "Maximum levels by food category."], US: ["restricted", "Permitted up to a limit (about 0.1%)."] },
    subs: ["Potassium sorbate"] },
  { name: "Aspartame", e: "E951", category: "Sweetener", aliases: ["nutrasweet"],
    rules: { EU: ["approved", "Label must state it contains a source of phenylalanine."], US: ["approved", "Label must state it contains phenylalanine."] },
    subs: [] },
  { name: "Monosodium glutamate", e: "E621", category: "Flavour enhancer", aliases: ["msg", "glutamate"],
    rules: { EU: ["approved", "Authorised with maximum levels in some categories."], US: ["approved", "Generally recognised as safe."] },
    subs: [] },
  { name: "Carrageenan", e: "E407", category: "Thickener", aliases: [],
    rules: { EU: ["approved", "Authorised; not for infant formula use in some forms."], US: ["approved", "Permitted thickener."] },
    subs: [] },
  { name: "Citric acid", e: "E330", category: "Acidity regulator", aliases: [],
    rules: { EU: ["approved", "Authorised."], US: ["approved", "Generally recognised as safe."] }, subs: [] },
  { name: "Ascorbic acid", e: "E300", category: "Antioxidant", aliases: ["vitamin c"],
    rules: { EU: ["approved", "Authorised."], US: ["approved", "Generally recognised as safe."] }, subs: [] },
  { name: "Calcium carbonate", e: "E170", category: "Colour", aliases: ["chalk"],
    rules: { EU: ["approved", "Authorised."], US: ["approved", "Generally recognised as safe."] }, subs: [] },
  { name: "Beetroot red", e: "E162", category: "Colour", aliases: ["betanin", "beet red"],
    rules: { EU: ["approved", "Authorised."], US: ["approved", "Exempt from certification."] }, subs: [] },
  { name: "Curcumin", e: "E100", category: "Colour", aliases: ["turmeric extract"],
    rules: { EU: ["approved", "Authorised."], US: ["approved", "Exempt from certification (turmeric)."] }, subs: [] },
  { name: "Potassium sorbate", e: "E202", category: "Preservative", aliases: [],
    rules: { EU: ["approved", "Authorised with maximum levels by category."], US: ["approved", "Generally recognised as safe."] }, subs: [] },
  { name: "Rosemary extract", e: "E392", category: "Antioxidant", aliases: [],
    rules: { EU: ["approved", "Authorised."], US: ["approved", "Permitted."] }, subs: [] },
  { name: "Tocopherols", e: "E306", category: "Antioxidant", aliases: ["vitamin e"],
    rules: { EU: ["approved", "Authorised."], US: ["approved", "Generally recognised as safe."] }, subs: [] },
];
