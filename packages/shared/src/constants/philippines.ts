// Philippines rice mill domain constants

export const RICE_VARIETIES = [
  { code: "Dinorado", name: "Dinorado", typical_recovery_pct: 65 },
  { code: "Jasmine Rice", name: "Jasmine Rice", typical_recovery_pct: 64 },
  { code: "Sinandomeng", name: "Sinandomeng", typical_recovery_pct: 65 },
  { code: "Maharlika", name: "Maharlika", typical_recovery_pct: 65 },
  { code: "Brown Rice", name: "Brown Rice (Unpolished Rice)", typical_recovery_pct: 78 },
  { code: "Red Rice", name: "Red Rice", typical_recovery_pct: 70 },
  { code: "Black Rice", name: "Black Rice", typical_recovery_pct: 70 },
  { code: "Malagkit", name: "Malagkit (Glutinous Rice | Sticky Rice)", typical_recovery_pct: 65 },
];

export const QUALITY_GRADES = [
  { code: "A", name: "Grade A", min_moisture_pct: 0, max_moisture_pct: 14 },
  { code: "B", name: "Grade B", min_moisture_pct: 14.1, max_moisture_pct: 18 },
  { code: "C", name: "Grade C", min_moisture_pct: 18.1, max_moisture_pct: 22 },
  { code: "NFA1", name: "NFA Grade 1", min_moisture_pct: 0, max_moisture_pct: 14 },
  { code: "NFA2", name: "NFA Grade 2", min_moisture_pct: 14.1, max_moisture_pct: 18 },
];

export const BYPRODUCTS = [
  { type: "ipa", local_name: "Ipa (Rice Hull/Husk)" },
  { type: "darak", local_name: "Darak (Rice Bran)" },
  { type: "binlid", local_name: "Binlid (Broken Rice)" },
] as const;

export const WEIGHT_UNITS = {
  CAVAN: { name: "Cavan", kg: 50, abbreviation: "cv" },
  SACK: { name: "Sack (50kg)", kg: 50, abbreviation: "sack" },
  KG: { name: "Kilogram", kg: 1, abbreviation: "kg" },
};

export const PROVINCES_PH = [
  "Agusan del Norte",
  "Agusan del Sur",
  "Bukidnon",
  "Camiguin",
  "Davao del Norte",
  "Davao del Sur",
  "Davao Oriental",
  "Isabela",
  "Cagayan",
  "Pampanga",
  "Bulacan",
  "Nueva Ecija",
  "Tarlac",
  "Pangasinan",
  "Laguna",
  "Mindoro",
  "Palawan",
  // Add more as needed
];

export const SUPPLIER_TYPES = [
  { value: "farmer", label: "Farmer" },
  { value: "trader", label: "Palay Trader" },
  { value: "cooperative", label: "Farmers Cooperative" },
];

export const CUSTOMER_TYPES = [
  { value: "wholesaler", label: "Wholesaler" },
  { value: "retailer", label: "Retailer" },
  { value: "walk_in", label: "Walk-in Customer" },
];

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "check", label: "Check" },
];

// `name` is what the server and permissions use; `label` is what people see.
// The owner role is shown as "Boss".
export const ROLES = [
  { id: 1, name: "owner", label: "Boss" },
  { id: 2, name: "admin", label: "Admin" },
  { id: 3, name: "mill_operator", label: "Mill Operator" },
  { id: 4, name: "accountant", label: "Accountant" },
  { id: 5, name: "cashier", label: "Cashier" },
  { id: 6, name: "encoder", label: "Encoder" },
];

/** The display name of a role ("owner" → "Boss", "mill_operator" → "Mill
 *  Operator"); unknown names come back as given, and none as "". */
export function roleLabel(name: string | null | undefined): string {
  if (!name) return "";
  return ROLES.find((r) => r.name === name)?.label ?? name;
}

export const CURRENCY = "PHP";
export const TIMEZONE = "Asia/Manila";
export const CAVAN_KG = 50;
