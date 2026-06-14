# Product

## Register

product

## Users

Two distinct audiences share one codebase:

- **Tenant operators** — owners, accountants, cashiers, encoders, and mill operators at
  Philippine rice mills. Often older, non-technical, working on modest hardware, sometimes
  offline. They live inside daily operational tasks: recording palay purchases, milling
  batches, inventory, sales, dispatch, expenses.
- **Platform admin (SaaS owner)** — the operator of the whole service. Works in the `/admin`
  surface to manage tenants, subscriptions/plans, upgrade requests, and all users across the
  platform. This is a back-office control plane, used in longer focused sessions.

## Product Purpose

A full ERP for rice mills (procurement → milling → inventory → sales → dispatch → reporting),
sold as multi-tenant SaaS with a schema-per-client backend. Success = a mill owner can run the
business day to day without training, and the platform owner can provision, bill, and support
tenants from one admin console.

## Brand Personality

Capable, trustworthy, modern-but-calm. The product should feel like a confident professional
tool (Linear/Stripe-grade craft) without shouting. Color and motion carry life through one
brand gradient (emerald → cyan → violet), not through decoration. For seniors: large hit
targets, high contrast, readable type.

## Anti-references

- Rainbow dashboards where every metric card gets a different saturated color.
- Off-brand accent drift (e.g. an indigo admin bolted onto an emerald product).
- "Loading…" text and bare spinners where skeletons belong.
- Table headers and surfaces that look fine in light mode but break in dark mode.
- Glassmorphism as decoration rather than as the consistent surface material.

## Design Principles

1. **One system, every surface.** Tenant app and admin console share the same tokens,
   components, and brand gradient. Consistency over surprise.
2. **Color means something.** The accent marks brand, primary action, current selection, and
   real status (success/warning/danger). Counts and neutral data stay neutral.
3. **Senior-friendly by default.** Generous sizing, ≥4.5:1 body contrast, visible focus rings.
4. **State is never missing.** Every interactive surface has hover/focus/active/disabled, plus
   skeleton loading and teaching empty states.
5. **Quiet motion.** 150–250ms, ease-out, state-conveying only. No page-load choreography.

## Accessibility & Inclusion

Target WCAG AA. High-contrast text (tokens already bumped for senior readability), visible
focus-visible rings on all controls, full dark mode, and `prefers-reduced-motion` honored for
every animation.
