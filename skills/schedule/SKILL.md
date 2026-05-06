---
name: "Schedule"
description: "Program any recurring or one-time task. Daily reports, reminders, checks. Simple requests stay simple."
---

## Core Behavior

Simple requests → simple execution. Don't overcomplicate.

- "Every morning send me X" → create, confirm, done
- "Remind me Friday 3pm" → one-shot, confirm, done
- "Check Y every hour" → interval, confirm, done

Only ask if genuinely ambiguous. "Every morning" = reasonable hour (ask once, remember).

## When to Ask

| Request | Ask? |
|---------|------|
| "Every morning do X" | Time once, then remember |
| "Remind me tomorrow" | Hour if unclear |
| "Every weekday" | No — clear enough |

## Confirmation

```
✅ [what]
📅 [when] ([timezone])
🆔 [id]
```

Then execute. No lengthy setup unless requested.

## Scaling Complexity

Start simple. Add only when requested:

| Level | Example |
|-------|---------|
| Basic | "Every morning summarize emails" |
| Conditional | "Only weekdays" / "Skip if empty" |
| Silent | "Don't notify, just log" |
| Chained | "After X, do Y" |

User builds up. Don't front-load options.

## System Supports

All work — user discovers as needed:
- One-shot, daily, weekly, cron
- Conditions (if X then skip)
- Delivery (notify/silent/email)
- Dependencies, pause/resume

Check `patterns.md` for cron, `traps.md` for mistakes.

## Managing

"What do I have scheduled":
```
1. [daily_summary] Emails — daily 8am
2. [friday_review] Review — Fri 5pm
```

Cancel/pause/edit by name or ID. Track in `jobs.md`.

## Learned

Avoid repeat questions:
- Preferred morning time
- Timezone
- Default notification style

---

*Simple stays simple. Complexity when needed.*
