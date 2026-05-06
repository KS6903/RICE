// Philippines rice mill domain constants

export const RICE_VARIETIES = [
  { code: "Rc222", name: "NSIC Rc222", category: "inbred" as const, typical_recovery_pct: 66 },
  { code: "Rc216", name: "NSIC Rc216", category: "inbred" as const, typical_recovery_pct: 65 },
  { code: "Rc218", name: "NSIC Rc218", category: "inbred" as const, typical_recovery_pct: 65 },
  { code: "Rc298", name: "NSIC Rc298", category: "inbred" as const, typical_recovery_pct: 66 },
  { code: "PSB14", name: "PSB Rc14", category: "inbred" as const, typical_recovery_pct: 64 },
  { code: "SINAG", name: "Sinag", category: "hybrid" as const, typical_recovery_pct: 68 },
  { code: "MESTIZO", name: "Mestizo", category: "hybrid" as const, typical_recovery_pct: 68 },
  { code: "LOCAL", name: "Local Variety", category: "local" as const, typical_recovery_pct: 62 },
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
  "Agusan del Norte", "Agusan del Sur", "Bukidnon", "Camiguin",
  "Davao del Norte", "Davao del Sur", "Davao Oriental", "Isabela",
  "Cagayan", "Pampanga", "Bulacan", "Nueva Ecija", "Tarlac",
  "Pangasinan", "Laguna", "Mindoro", "Palawan",
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
  { value: "government", label: "Government (P20 Rice)" },
  { value: "walk_in", label: "Walk-in Customer" },
];

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "check", label: "Check" },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Fuel & Lubricants", is_production_cost: true },
  { name: "Electricity", is_production_cost: true },
  { name: "Labor / Wages", is_production_cost: true },
  { name: "Maintenance & Repair", is_production_cost: true },
  { name: "Drying Cost", is_production_cost: true },
  { name: "Transportation", is_production_cost: false },
  { name: "Office Supplies", is_production_cost: false },
  { name: "Government Fees", is_production_cost: false },
];

export const ROLES = [
  { id: 1, name: "owner", label: "Owner" },
  { id: 2, name: "admin", label: "Admin" },
  { id: 3, name: "mill_operator", label: "Mill Operator" },
  { id: 4, name: "accountant", label: "Accountant" },
  { id: 5, name: "cashier", label: "Cashier" },
  { id: 6, name: "encoder", label: "Encoder" },
];

export const CURRENCY = "PHP";
export const TIMEZONE = "Asia/Manila";
export const CAVAN_KG = 50;
