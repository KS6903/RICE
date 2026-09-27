"""Scheduled jobs: work that runs on a clock instead of on a request.

The Worker's cron trigger starts the JobsContainer every 15 minutes
(worker/index.ts), which runs ``python -m app.jobs``: it does whatever is due,
then exits. Each job (registry.py) has a scope (once platform-wide, or once per
tenant), a schedule deciding when it is due and naming that run, and a function
that does the work. job_runs records every run, so none happens twice.
"""
