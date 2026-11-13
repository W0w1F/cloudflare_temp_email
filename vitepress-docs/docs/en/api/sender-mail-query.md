# Query site-wide mail by sender

Incoming mail already persists Cloudflare `message.from` in `raw_mails.source`. Reuse this SMTP envelope sender as the identifier: no new column or migration, and historical rows remain searchable. It is not the display name, header From, Message-ID or a platform user ID, and is not proof of sender identity.

## API

`GET /admin/mails?sender=sender%40example.com&limit=100&offset=0`

Requires existing administrator authentication (`x-admin-auth` or an administrator role access token), plus `x-custom-auth` when configured. The admin IP allowlist still applies. Never embed administrator credentials in a public frontend.

| Parameter | Meaning |
|---|---|
| sender | Optional full envelope address; trims surrounding whitespace, ASCII case-insensitive exact match, no wildcards; explicitly blank values return 400 |
| address | Optional recipient filter, combined with sender using AND; omit to search all domains/mailboxes in this deployment's database |
| limit | Required page size, 1–100 |
| offset | Required offset starting at 0 |

Omitting sender preserves existing list behavior. Only retained mail is returned, including matching unknown-recipient records; rejected/deleted mail cannot be retrieved.

Response: `{ "results": [...], "count": 2 }`, ordered by descending mail ID. Rows include `id`, `source`, `address`, `raw` (MIME) and existing fields. Existing decompression handles compressed storage. No matches return an empty results array. Only offset=0 reports the total count; later pages return count=0.

```bash
curl --get "$BASE/admin/mails"   -H "x-admin-auth: $ADMIN_PASSWORD"   --data-urlencode 'sender=sender@example.com'   --data-urlencode 'limit=100' --data-urlencode 'offset=0'
```

Increase offset by 100 until results contains fewer than 100 rows. Offset pagination is not a snapshot during concurrent arrivals/deletions; deduplicate by ID and refresh as necessary. Parse raw locally using a MIME parser for bodies/attachments.

Filtering runs server-side before returning mail. No anonymous endpoint is introduced and mailbox JWT permissions are unchanged.
