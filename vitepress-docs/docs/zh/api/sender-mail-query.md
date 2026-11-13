# 按发件人查询全站邮件

## 存储与含义

收信流程已将 Cloudflare Email Worker 的 `message.from` 写入 `raw_mails.source`。本接口复用此字段作为发件人标识，不新增数据库列，无需迁移，历史记录同样可查。它是 SMTP 信封发件人地址，不是显示名称、邮件头 From、Message-ID 或平台用户 ID，也不构成发件人身份认证。

## API

`GET /admin/mails?sender=sender%40example.com&limit=100&offset=0`

需要管理员鉴权：`x-admin-auth`，或现有的管理员角色访问令牌；配置全站密码时还需 `x-custom-auth`。现有管理员 IP 白名单仍生效。**不要将管理员凭据嵌入公开前端。**

| 参数 | 说明 |
|---|---|
| sender | 可选；去除首尾空白后按完整地址精确匹配，ASCII 大小写不敏感，不支持通配符；显式空值返回 400 |
| address | 可选收件邮箱，与 sender 同时使用时取交集；省略则跨本站数据库内所有域名和邮箱查询 |
| limit | 必填，每页 1–100 |
| offset | 必填，从 0 开始的偏移量 |

省略 sender 保持原有管理员列表行为。查询只返回已保存且尚未删除的邮件，包括符合条件的未知收件地址记录；被拒收或已经删除的邮件不可查询。

响应沿用 `{ "results": [...], "count": 2 }`，结果按邮件 ID 降序。每条包含 `id`、`source`（发件人）、`address`（收件邮箱）、`raw`（原始 MIME 邮件）及现有其他字段；压缩存储通过既有逻辑解压。无匹配时 results 为空。只有 offset=0 时 count 是总匹配数，后续页 count 为 0，不要据此提前结束。

## 本地调用

```bash
curl --get "$BASE/admin/mails"   -H "x-admin-auth: $ADMIN_PASSWORD"   --data-urlencode 'sender=sender@example.com'   --data-urlencode 'limit=100' --data-urlencode 'offset=0'
```

如需全部结果，将 offset 依次增加 100，直到 results 长度小于 100。持续收信或删除期间偏移分页不是快照，可能重复或遗漏；本地应按 id 去重，并按需要重新拉取。返回的 raw 可使用本地 MIME 解析器提取正文和附件。

没有新增公开匿名接口，也不改变现有邮箱 JWT 的访问范围。此功能由服务端 SQL 完成过滤，本地仅接收过滤后的邮件。

[增量同步接口](./sender-mail-sync.md)
