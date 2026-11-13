# Incremental sender mail synchronization

`GET /admin/mails/sync` uses existing admin authentication, optional site-password authentication and the admin IP policy. Searches retained mail across this deployment; optional address restricts the recipient.

Prerequisite: deployment mail IDs must increase without reuse. This feature does not change the database. The repository's current INTEGER PRIMARY KEY definition alone does not guarantee non-reuse after deletion. Reset synchronization state after database replacement/restoration.

## Initialize a task checkpoint

`GET /admin/mails/checkpoint` requires the same admin authentication and no parameters. Returns `{"cursor":500}` using the maximum currently retained mail ID across the deployment, or 0 for an empty table. The response includes `Cache-Control: no-store`.

```bash
curl "$BASE/admin/mails/checkpoint" -H "x-admin-auth: $ADMIN_PASSWORD"
```

Call once before triggering any mail-producing action, persist the result as the task's initial cursor, then use the sync endpoint with that cursor and the task's sender/address filters. If checkpoint retrieval fails, do not trigger the action. Each task owns its cursor and in-progress until_id independently. A cursor does not establish mail ownership; recipient and business rules still apply.

Subsequent polls and task recovery must use the saved next_cursor, not a fresh checkpoint, or intervening mail will be skipped. To include historical mail, start with cursor=0 instead.

| Parameter | Meaning |
|---|---|
| sender | Required full SMTP envelope sender; trimmed, ASCII case-insensitive exact match |
| address | Optional exact recipient; explicitly blank values rejected |
| cursor | Nonnegative safe integer, default 0; use saved next_cursor |
| until_id | Fixed upper bound for page continuation; omit when starting a new round; must be >= cursor |
| limit | Integer 1–100, default 100 |

Response: `{"results":[],"next_cursor":650,"until_id":650,"has_more":false}`. Rows use the existing mail representation, including decompressed raw MIME, ordered by ascending ID. No total count is returned.

First request omits until_id and captures the database maximum ID. Query bounds are cursor < id <= until_id. Persist returned mail and next_cursor together locally, deduplicating by mail ID. If has_more=true, continue with next_cursor and the same until_id and filters. If has_more=false, discard until_id and retain next_cursor for the next polling round. Even empty results advance the completed checkpoint. Never advance after request/local persistence failure.

Keep independent state per task, deployment and sender/address combination; reset to 0 when changing filters. This is not a database snapshot: deleted mail cannot be recovered, and new mail above the upper bound waits for the next round. The boundary is server database observation time, not the exact client request time or the sender's Date header. A cursor is not an authentication credential.

```bash
curl --get "$BASE/admin/mails/sync"   -H "x-admin-auth: $ADMIN_PASSWORD"   --data-urlencode 'sender=sender@example.com'   --data-urlencode 'cursor=0' --data-urlencode 'limit=100'
```
