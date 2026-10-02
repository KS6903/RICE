# Sub-processor register

This register lists the third parties that process data for {{product_name}} on our behalf. It is
referenced by the [Privacy Policy](/legal/privacy) and section 6 of the
[Data Processing Addendum](/legal/dpa).

We give at least 30 days' notice before adding or replacing a sub-processor that handles personal
information. Changes are recorded in the change log at the bottom of this page.

## Infrastructure

| Provider | Purpose | Data it can access | Location |
|---|---|---|---|
| Cloudflare, Inc. | Application hosting, edge network, TLS termination, DDoS and WAF protection | All traffic in transit, including account and Customer Data | Global edge; United States entity |
| {{db_host_provider}} | Managed PostgreSQL database | All account data and Customer Data at rest | {{db_host_region}} |
| {{redis_provider}} | Managed Redis for rate-limit, lockout and cache state | IP addresses, usernames attempted, session identifiers, cached forecasts | {{redis_region}} |
| {{smtp_provider}} | Transactional email delivery | Recipient name and email address, and the contents of verification, reset, security and billing messages | {{smtp_region}} |

## Product features

| Provider | Purpose | Data it receives | Location |
|---|---|---|---|
| DeepSeek | Generates the Drying Advisor verdict from forecast data | **Weather data only**: coordinates, place name, and forecast values already reduced to a fixed vocabulary of condition labels on our servers. No personal information, no account information, no Customer Data. No chat or free-text path exists. | People's Republic of China |
| DeepSeek | Writes the AI advisor's advice (Enterprise plan; **only while the mill's owner has switched it on**) | Figures computed from the mill's records (purchases, milling, stock, sales, invoices, payments, expenses) and the names of the mill's customers, suppliers and staff. **Never** telephone numbers, addresses, TINs, government identifier numbers, or text users typed into notes, remarks or descriptions. No chat or free-text path exists. | People's Republic of China |
| Open-Meteo | Weather forecast and place-name geocoding | Coordinates or a place-name search string. No personal information. | Germany / European Union |
| Google LLC (Weather API) | Alternative weather forecast source | Coordinates. No personal information. | United States |
| Google LLC (Sign in with Google) | Optional federated sign-in | Authentication exchange only. Google returns the account identifier, email address and name to us; we do not send Google your {{product_name}} data. | United States |
| ipapi.co | Coarse location fallback, used only to pick a default weather location when no coordinates are given | The requesting IP address | United States |
| Have I Been Pwned (Pwned Passwords) | Checks new passwords against known-breached corpora | **The first 5 characters of the SHA-1 hash of the password only**, using the k-anonymity range API. The password, its full hash, and your identity are never sent. | Cloudflare edge |

## Not used

For the avoidance of doubt, {{product_name}} does not use advertising networks, third-party
analytics or tracking cookies, session-replay tools, data brokers, or any provider that receives
Customer Data for its own purposes. We do not use Customer Data to train any machine learning or
artificial intelligence model. DeepSeek's own policy allows it to use what it receives to improve its
models unless the account holder opts out. {{deepseek_training_optout}}

## Notes on minimisation

Weather and the Drying Advisor are built so that **no personal information leaves our systems**.
Forecast conditions are mapped to a closed vocabulary on our servers before any request is made, and
the advisory endpoint accepts no user-supplied free text. This is a design property, not a policy
promise: there is no code path that sends an account record, an employee record or a mill record to
those providers.

The AI advisor is the exception, and it is off until a mill's owner switches it on. Its recipes
compute every figure on our servers and send DeepSeek those figures and the names involved; the
queries that gather them never select telephone numbers, addresses, TINs, government identifier
numbers or free text, and an automated test plants each of those in the data and fails if any reaches
the model.

The `ipapi.co` fallback is the one feature that sends an IP address off-platform. It only runs when
no coordinates are supplied. If you supply or save a location, it is not called.

## Change log

| Date | Change |
|---|---|
| {{effective_date}} | Initial register published. |
| {{ai_advisor_effective_date}} | DeepSeek added for the AI advisor: mill figures and names, only for mills whose owner switches it on. Location corrected to the People's Republic of China, as DeepSeek's policy states. |
