import { t } from "../../i18n";
// What each page is for, in a sentence or two. The walkthrough shows it for
// each stop. Keep it short, and true to what the app does.

export const PAGE_WHAT: Record<string, string> = {
  "/": t(
    "Your home screen: this month's profit, your palay and rice stock, and the weather for drying.",
  ),
  "/paddy": t(
    "Record each delivery of palay you buy: variety, weight, moisture and price. It's added to your palay stock.",
  ),
  "/rice": t(
    "Record the milled rice you buy from other mills and traders: variety, grade, sacks and price. It's added to your rice stock.",
  ),
  "/byproducts": t(
    "Record the ipa, darak and binlid you buy: weight and price per kg. It's added to your by-product stock.",
  ),
  "/milling": t(
    "Record the palay going into the mill and whose it is. Oraiza estimates the rice, ipa and darak that come out; type the weighed kilos to replace them. Palay leaves your stock; the rice and by-products go into Inventory.",
  ),
  "/maintenance": t("When each machine is due for service, counted from the milling it has done."),
  "/inventory": t(
    "Everything in your warehouses, by branch. Already had stock before Oraiza? Enter it once with Add inventory.",
  ),
  "/stock-count": t(
    "Count what's really on hand. You see what the records say only after saving, so the count stays honest.",
  ),
  "/catalog": t(
    "The lists you fill in once and every page picks from: varieties, by-products, categories, machines, trucks and the people you deal with.",
  ),
  "/sales": t("Customer orders, then invoices once they're confirmed, plus your customer list."),
  "/dispatch": t("Delivery trips, and your trucks and drivers."),
  "/operators": t("Delivery agents, third-party millers and palay suppliers."),
  "/collections": t("Who owes you money, who to chase first, and a reminder ready to send."),
  "/cash": t("Count the cash drawer at closing. Oraiza works out what should be there."),
  "/costs": t(
    "Fuel, power, labor, repairs: everything the mill pays for. With costs in, your profit is real.",
  ),
  "/reports": t("Profit and loss for any dates you pick, and more reports on higher plans."),
  "/tasks": t("Problems someone is fixing: who, by when, and what was done."),
  "/automations": t("Reports and alerts that run by themselves. Switch on the ones you want."),
  "/employees": t(
    "Staff records: positions, branches and hire dates. A record here isn't a login.",
  ),
  "/users": t("Logins for your staff. Each person's role decides what they can see and change."),
  "/settings": t(
    "Company details, branches, rice varieties, equipment and billing, plus your own password and devices.",
  ),
};
