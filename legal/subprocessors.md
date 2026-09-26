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
| DeepSeek | Generates the Drying Advisor verdict from forecast data | **Weather data only**: coordinates, place name, and forecast values already reduced to a fixed vocabulary of condition labels on our servers. No personal information, no account information, no Customer Data. No chat or free-text path exists. | Outside the Philippines |
| Open-Meteo | Weather forecast and place-name geocoding | Coordinates or a place-name search string. No personal information. | Germany / European Union |
| Google LLC (Weather API) | Alternative weather forecast source | Coordinates. No personal information. | United States |
| Google LLC (Sign in with Google) | Optional federated sign-in | Authentication exchange only. Google returns the account identifier, email address and name to us; we do not send Google your {{product_name}} data. | United States |
| ipapi.co | Coarse location fallback, used only to pick a default weather location when no coordinates are given | The requesting IP address | United States |
| Have I Been Pwned (Pwned Passwords) | Checks new passwords against known-breached corpora | **The first 5 characters of the SHA-1 hash of the password only**, using the k-anonymity range API. The password, its full hash, and your identity are never sent. | Cloudflare edge |

## Not used

For the avoidance of doubt, {{product_name}} does not use advertising networks, third-party
analytics or tracking cookies, session-replay tools, data brokers, or any provider that receives
Customer Data for its own purposes. No Customer Data is used to train any machine learning or
artificial intelligence model, by us or by any provider above.

## Notes on minimisation

The two features that reach outside our infrastructure with any regularity, weather and the Drying
Advisor, are built so that **no personal information leaves our systems**. Forecast conditions are
mapped to a closed vocabulary on our servers before any request is made, and the advisory endpoint
accepts no user-supplied free text. This is a design property, not a policy promise: there is no
code path that sends an account record, an employee record or a mill record to those providers.

The `ipapi.co` fallback is the one feature that sends an IP address off-platform. It only runs when
no coordinates are supplied. If you supply or save a location, it is not called.

## Change log

| Date | Change |
|---|---|
| {{effective_date}} | Initial register published. |
