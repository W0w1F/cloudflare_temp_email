# 本 fork API 新增与变更记录

本文集中记录本 fork 新增、修改的 HTTP API 的用途和用法。**今后新增、修改或废弃 API 时，必须同步更新本文**，并继续维护中英文功能文档与 CHANGELOG。上游 API 的固定版本索引不代替本文件；代码实现不代表已经部署。

每次更新至少写明：HTTP 方法与路径、用途、认证和权限、请求参数及默认值、响应字段、调用示例、错误与边界行为、兼容性以及迁移要求。修改旧接口时更新对应章节；破坏性变更需明确标出。

## 通用约定

- `BASE`：实际 Worker 或反向代理基础 URL，不含末尾 `/`。
- 本文接口均为管理员接口，示例使用 `x-admin-auth: $ADMIN_PASSWORD`；也可使用现有管理员角色访问令牌路径。管理员 IP 白名单仍然生效。
- 配置全站密码时，额外提供 `x-custom-auth`。全站密码不能替代管理员凭据。
- 不要将管理员凭据放进公开前端、日志或仓库。
- `sender` 指 SMTP 信封发件人（Cloudflare `message.from`），已存入 `raw_mails.source`；不是显示名称、邮件头 From 或 Message-ID，不代表身份认证。
- 只返回当前数据库保留的邮件；拒收或已删除的邮件无法获取。
- 错误可能是纯文本或 JSON，客户端应检查 HTTP 状态和 Content-Type。现有全局认证、数据库配置与异常处理仍然适用。

## 1. 修改：按发件人筛选邮件

### `GET /admin/mails`

**用途：** 在原有管理员邮件列表上增加 `sender` 参数，在云端筛选某个发件人发送到本站所有邮箱的邮件；也可限定收件邮箱。

| 参数 | 必填 | 说明 |
|---|---|---|
| sender | 否 | 完整发件地址，去除首尾空白，ASCII 大小写不敏感精确匹配；不支持通配符；显式空白返回 400 |
| address | 否 | 收件邮箱，与 sender 取交集；省略则不限定收件邮箱 |
| limit | 是 | 每页 1–100 |
| offset | 是 | 从 0 开始的分页偏移量 |

```bash
curl --get "$BASE/admin/mails" \
  -H "x-admin-auth: $ADMIN_PASSWORD" \
  --data-urlencode 'sender=notify@example.com' \
  --data-urlencode 'limit=100' \
  --data-urlencode 'offset=0'
```

响应结构：

```json
{
  "results": [
    {"id": 501, "source": "notify@example.com", "address": "task1@example.org", "raw": "原始 MIME 内容"}
  ],
  "count": 1
}
```

示例仅展示部分邮件字段。结果按 ID 降序，压缩存储的正文沿用现有解压逻辑。只有 offset=0 时 count 表示总匹配数，后续页 count 为 0。没有匹配时 results 为空。

**兼容性：** 不传 sender 保持原有列表行为，无数据库迁移。持续新增或删除邮件可能导致 offset 分页漂移；连续同步优先使用下面的 sync 接口。

## 2. 新增：按 ID 游标增量同步邮件

### `GET /admin/mails/sync`

**用途：** 按发件人获取上次游标之后新增入库的邮件，支持固定上界分页，避免每次重复拉取全部历史邮件。

| 参数 | 必填 | 说明 |
|---|---|---|
| sender | 是 | 同上，完整 SMTP 发件地址；缺失或空白返回 400 |
| address | 否 | 收件邮箱，去除首尾空白后精确匹配；显式空白返回 400 |
| cursor | 否 | 非负安全整数，默认 0；仅返回 id 大于此值的邮件 |
| until_id | 否 | 本轮固定 ID 上界，非负安全整数且不小于 cursor；新一轮省略，翻页时沿用响应值 |
| limit | 否 | 整数 1–100，默认 100 |

游标和分页数字必须为十进制数字字符串且不超过 JavaScript 安全整数范围；非法值返回 400。

```bash
curl --get "$BASE/admin/mails/sync" \
  -H "x-admin-auth: $ADMIN_PASSWORD" \
  --data-urlencode 'sender=notify@example.com' \
  --data-urlencode 'address=task1@example.org' \
  --data-urlencode 'cursor=500' \
  --data-urlencode 'limit=100'
```

响应结构：

```json
{
  "results": [
    {"id": 510, "source": "notify@example.com", "address": "task1@example.org", "raw": "原始 MIME 内容"}
  ],
  "next_cursor": 650,
  "until_id": 650,
  "has_more": false
}
```

| 响应字段 | 含义 |
|---|---|
| results | 匹配邮件行，按 ID 升序，含现有 raw 等字段；无总数字段 |
| next_cursor | 本页保存成功后要持久化的下一读取位置 |
| until_id | 本轮固定上界，翻页必须沿用 |
| has_more | 本轮是否还有匹配邮件需要继续翻页 |

### 分页和恢复规则

1. 新一轮不传 until_id。服务器读取全站当前最大 ID，并取其与 cursor 的较大值作为本轮上界。
2. 查询范围为 `cursor < id <= until_id`，再按 sender/address 过滤。
3. has_more=true：使用 next_cursor 和同一个 until_id 继续请求，筛选条件保持不变。
4. has_more=false：本轮完成，next_cursor 推进到本轮上界。保存 next_cursor，清除 until_id，下次轮询重新取得上界。
5. 空结果也保存返回的 next_cursor，不要反复扫描同一段没有匹配的记录。
6. 先保存邮件，再保存游标，最好在本地同一事务提交。失败不推进；重试可能重复返回，按部署标识及邮件 ID 去重。

每个任务独立保存 cursor 和分页中的 until_id；同一任务更换筛选条件时应重新明确同步起点。游标不决定邮件归属，任务隔离依然需要收件邮箱及业务匹配规则。

**边界与兼容性：** 不修改原有邮件列表接口，不迁移数据库。查询不是严格数据库快照；查询前删除的邮件无法读取，超过本轮上界的新邮件留到下一轮。以入库顺序为准，不按发件时间或邮件头 Date 判断。

> **部署前提：邮件 ID 必须递增且不会复用。** 仓库当前的 `INTEGER PRIMARY KEY` 本身不保证删除后不复用，本功能依赖部署方确认的保证，并未自动修复表结构。数据库重建或恢复后应重新初始化同步状态。

## 3. 新增：获取任务初始游标

### `GET /admin/mails/checkpoint`

**用途：** 在任务启动、触发发信之前取得全站当前最大邮件 ID，作为该任务自己的初始 cursor，默认排除已有历史邮件。

无需请求参数。不按 sender/address 过滤，响应设置 `Cache-Control: no-store`。

```bash
curl "$BASE/admin/mails/checkpoint" \
  -H "x-admin-auth: $ADMIN_PASSWORD"
```

```json
{"cursor":500}
```

cursor 是当前保留邮件的最大 ID；空表返回 0。接口只读取数据库，不预留 ID、不创建服务器端任务、不修改邮件状态，无需数据库迁移。

### 多任务完整调用顺序

```text
任务二 10:00：checkpoint → cursor=300 → 保存任务二进度 → 触发发信
任务一 11:00：checkpoint → cursor=500 → 保存任务一进度 → 触发发信

任务二：sync(sender, address=task2, cursor=300) → 独立保存 next_cursor
任务一：sync(sender, address=task1, cursor=500) → 独立保存 next_cursor
```

- 必须先取得并保存 checkpoint，再执行可能产生目标邮件的动作；获取失败不应继续触发发信。
- 每个任务初始化时获取一次；后续轮询和恢复使用已保存的 next_cursor，不能每次重新取 checkpoint，否则会跳过等待期间收到的邮件。
- 如果要包含历史邮件，直接从 cursor=0 开始，不使用 checkpoint。
- 已经开始但没有保存起点的任务，不能通过当前 checkpoint 反推出历史时间的 ID。

## 相关文档

- [发件人筛选（中文）](vitepress-docs/docs/zh/api/sender-mail-query.md)
- [增量同步与任务初始化（中文）](vitepress-docs/docs/zh/api/sender-mail-sync.md)
- [Sender filtering (English)](vitepress-docs/docs/en/api/sender-mail-query.md)
- [Incremental synchronization (English)](vitepress-docs/docs/en/api/sender-mail-sync.md)
