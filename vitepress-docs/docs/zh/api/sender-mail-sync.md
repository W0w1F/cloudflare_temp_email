# 按发件人增量同步邮件

`GET /admin/mails/sync`

使用现有管理员鉴权（例如 `x-admin-auth`）；配置全站密码时同时提供 `x-custom-auth`。管理员 IP 限制保持生效。查询跨本站所有收件邮箱，也可以用 address 限定单个邮箱。

> 前提：部署中的邮件 ID 必须单调递增且不复用。本功能不修改数据库。仓库当前 `INTEGER PRIMARY KEY` 定义本身不保证删除后不复用，部署方须自行保证这一前提。数据库重建/恢复后应重置同步状态。

## 任务启动时获取初始游标

`GET /admin/mails/checkpoint` 使用同样的管理员鉴权，无需请求参数。返回全站当前保留邮件的最大 ID，空表返回 0；响应设置 `Cache-Control: no-store`。

```bash
curl "$BASE/admin/mails/checkpoint" -H "x-admin-auth: $ADMIN_PASSWORD"
```

```json
{"cursor":500}
```

每个任务在触发发信操作之前调用一次，将返回值保存为自己的初始 cursor。随后调用 `/admin/mails/sync?sender=sender%40example.com&address=task1%40example.com&cursor=500`，只读取该起点之后的新邮件。无需按发件人筛选 checkpoint。

任务之间分别保存 cursor 和分页中的 until_id，即使 sender/address 相同也不要共用任务进度。游标只决定读取起点，邮件归属仍需收件邮箱和业务规则区分。首次 checkpoint 请求失败时，不应继续触发发信。

**后续轮询使用同步接口返回的 next_cursor，不要重新获取 checkpoint，否则会跳过等待期间的新邮件。** 任务恢复也应沿用已保存的进度。希望包含历史邮件时，初始 cursor 使用 0，而不是 checkpoint。

## 参数

| 参数 | 说明 |
|---|---|
| sender | 必填，SMTP 信封发件人完整地址；去首尾空白，ASCII 大小写不敏感精确匹配 |
| address | 可选，限定收件邮箱；显式空白值拒绝 |
| cursor | 非负安全整数，上次保存的 next_cursor；首次省略或传 0 |
| until_id | 本轮固定上界；新一轮省略，翻页时必须沿用响应值；不得小于 cursor |
| limit | 1–100 的整数，默认 100 |

初始 cursor=0 时返回截止服务器读取最大 ID 时，仍保留在库中的全部匹配邮件（分多页）；使用 checkpoint 则只读取该起点之后的邮件。时间边界以数据库读取上界为准，不是客户端发出请求的准确时刻。只读已入库邮件，不按邮件头 Date 判断。

```bash
curl --get "$BASE/admin/mails/sync"   -H "x-admin-auth: $ADMIN_PASSWORD"   --data-urlencode 'sender=sender@example.com'   --data-urlencode 'cursor=0' --data-urlencode 'limit=100'
```

响应示例：

```json
{"results":[],"next_cursor":650,"until_id":650,"has_more":false}
```

results 为现有邮件行，包含 id、source、address、raw 等字段，按 ID 升序返回，压缩正文沿用现有解压逻辑。不提供总数。

## 本地同步流程

1. 首次 cursor 使用任务启动时的 checkpoint（需要历史邮件则使用 0），不传 until_id。后端固定本轮上界并查询 `cursor < id <= until_id`。
2. 本地保存结果后保存 next_cursor，建议同一事务提交，并按邮件 ID 去重。
3. has_more=true：继续请求，cursor 使用 next_cursor，until_id 使用本轮响应值，sender/address 必须保持不变。
4. has_more=false：本轮结束，保存 next_cursor，但清除 until_id。10:20 再同步时携带已保存的 cursor，不传 until_id，服务器重新确定上界。
5. 空结果仍保存 next_cursor。无匹配邮件也会推进至本轮上界，避免反复扫描。

每个任务及其部署、sender/address 筛选组合分别保存同步状态；改变筛选条件应重新从 0 开始。上界并非数据库快照，查询前已删除的邮件无法恢复。请求期间新到达且超过本轮上界的邮件留到下一轮。请求或本地保存失败不得推进游标，重试可能重复返回，由本地去重。客户端不得把旧 until_id 永久带入新一轮，否则无法接收后续邮件。游标是同步位置，不是授权凭据。
