# Scheduled Jobs

Active jobs for this user. Update on add/remove/edit.

## Format
```
## [id]
- Description: [what]
- Schedule: [cron/interval/one-shot]
- Timezone: [zone]
- Next: [ISO timestamp]
- Created: [date]
- Status: active | paused | completed
```

## Example
```
## reminder_standup
- Description: Daily standup reminder
- Schedule: 0 9 * * 1-5 (weekdays 9am)
- Timezone: Europe/Madrid
- Next: 2026-02-12T09:00:00+01:00
- Created: 2026-02-10
- Status: active
```

---

## Active Jobs
<!-- Add jobs here as created -->

## Paused Jobs
<!-- Jobs temporarily disabled -->

## Completed
<!-- One-shot jobs that fired -->
