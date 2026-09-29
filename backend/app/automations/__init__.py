"""Tenant automations: ready-made recipes an Enterprise mill switches on.

A recipe (recipes/) says what to compute, when, and who may receive it. The
tenant's settings for it live in automation_rules. engine.run_due_automations
runs every due recipe on each jobs tick, and turns its results into
notifications, which the notifications job then emails.
"""
