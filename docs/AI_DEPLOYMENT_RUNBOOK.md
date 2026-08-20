# NoteFlow 正式环境部署 Runbook（供 AI 执行）

> 本文件用于让后续 AI 按固定流程完成 NoteFlow 的线上部署、数据库迁移和上线验证。
> 执行前必须同时读取仓库根目录的 `AGENTS.md`。本文件不是授权书：AI 只能执行用户本轮明确要求的变更。

## 1. 当前生产环境

除非用户本轮提供了新的环境信息，否则按以下约定执行：

| 项目 | 值 |
| --- | --- |
| Git 仓库 | `https://github.com/yunbocheng4379/NoteFlow.git` |
| 服务器 | `root@47.99.136.241` |
| 项目目录 | `/opt/NoteFlow` |
| 公网地址 | `https://www.noteflow.vip` |
| 外层网关项目 | `/opt/website` |
| 外层网关容器 | `website-web-1` |
| NoteFlow 入口容器 | `noteflow-nginx` |
| 后端容器 | `noteflow-backend` |
| 前端容器 | `noteflow-frontend` |
| 数据库容器 | `noteflow-mysql` |
| 宿主机入口端口 | `3015` |
| 后端端口 | `8483` |

服务器密码、SSH 私钥、`.env`、数据库密码、JWT 密钥、Cookie 密钥、支付宝私钥、支付宝公钥文件都属于敏感信息：

- 不写入本文件、不提交 Git、不在命令输出和最终回复中打印；
- 只从用户或已授权的密钥管理工具获取；
- 缺少凭据时向用户索取，不要猜测或把秘密写进命令历史；
- 不要把本地 `.env`、PEM 文件或完整支付 URL 上传到公共仓库。

## 2. 本地检查、测试、提交和推送

### 2.1 检查工作区

```bash
cd /path/to/NoteFlow
pwd
git status --short
git diff --check
```

如果有与本轮需求无关的改动，必须保留并避开。不要使用以下破坏性操作：

```text
git reset --hard
git checkout -- <文件>
git clean -fd
```

### 2.2 验证代码

前端变更至少执行：

```bash
pnpm --dir NoteFlow_frontend build
```

后端变更执行对应的测试；支付、订单、数据库迁移、视频搜索变更优先执行相关 `backend/tests/` 测试。任何非零退出码都必须先解决，不能以“线上再看”为理由继续发布。

### 2.3 只提交本轮变更

不要无选择地执行 `git add .`。先查看待提交内容：

```bash
git add <本轮明确修改的文件>
git diff --cached --stat
git diff --cached --check
git commit -m "<简短且准确的变更说明>"
git push origin main
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

部署报告必须写出最终 commit。若推送失败或远程分支有新提交，停止并处理分支关系，不要强制推送。

## 3. 服务器预检

认证方式由用户或密钥管理工具提供。以下示例中的主机和用户不得被 AI 擅自替换：

```bash
ssh root@47.99.136.241
cd /opt/NoteFlow
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
git status --short
git branch --show-current
git log -1 --oneline
```

服务器可能存在正式环境专用的 `docker-compose.yml`、`backend/requirements.txt`、`.env` 或网关配置。处理规则：

1. 先保存 `git status` 和必要的 `git diff`；
2. 只有工作区干净且历史可快进时才执行 `git pull --ff-only origin main`；
3. 分支分叉或工作区有部署专用改动时，使用经过核对的定向文件同步、镜像构建或人工合并；
4. 不得为了部署执行 `git reset --hard`、强制覆盖 `.env`、删除 Docker 数据卷或覆盖服务器专用配置。

## 4. 数据库备份

只要涉及后端模型、订单、充值、会员、支付或 SQL，就必须先备份：

```bash
cd /opt/NoteFlow
set -a
. ./.env
set +a
mkdir -p backups
BACKUP_FILE="backups/noteflow_$(date +%Y%m%d_%H%M%S).sql"
docker exec noteflow-mysql mysqldump \
  --default-character-set=utf8mb4 \
  -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --databases "$MYSQL_DATABASE" > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
ls -lh "$BACKUP_FILE"
```

记录备份路径和文件大小。备份失败时停止部署。

## 5. 执行 SQL 迁移

SQL 必须来自已提交、已检查的项目文件。先阅读文件，再执行同一个文件，不要让 AI 手工重写 SQL：

```bash
SQL_FILE="/opt/NoteFlow/backend/sql/<已审核的迁移文件>.sql"
sed -n '1,240p' "$SQL_FILE"
docker cp "$SQL_FILE" noteflow-backend:/tmp/noteflow-migration.sql
docker exec noteflow-backend python -c "from pathlib import Path; from sqlalchemy import text; from app.db.engine import get_engine; sql=Path('/tmp/noteflow-migration.sql').read_text(encoding='utf-8'); engine=get_engine(); conn=engine.connect(); result=conn.execute(text(sql)); conn.commit(); print('sql_rowcount', result.rowcount); conn.close()"
```

执行后必须用只读查询核对结果，并记录 `sql_rowcount`。迁移失败时停止后续发布，先查看日志和备份，不要盲目重复执行。

### 5.1 临时一分钱测试价

`backend/sql/migrate_basic_recharge_to_one_cent.sql` 仅在用户明确要求支付宝小额联调时执行。它会把 `PKG_BASIC` 的价格改成 1 分钱，不是默认部署步骤。已有订单金额不应被回写修改。

测试结束并且用户确认恢复时，执行以下逆向 SQL：

```sql
UPDATE recharge_packages
SET price_cents = 990,
    unit_price_text = '¥0.099/电力'
WHERE code = 'PKG_BASIC';
```

恢复后再次只读查询 `code`、`price_cents` 和 `unit_price_text`。未得到用户确认前，不要擅自恢复或再次改价。

## 6. 发布后端和前端

### 6.1 优先使用完整 Docker 构建

备份和代码检查完成后，优先执行可复现的正式构建：

```bash
cd /opt/NoteFlow
docker compose up -d --build
```

GPU 环境使用：

```bash
docker compose -f docker-compose.gpu.yml up -d --build
```

### 6.2 构建过慢时的定向同步

只有在变更很小、文件已在本地测试并已提交时，才允许定向同步。不要把它当成完整构建的替代品。

本地上传：

```bash
scp backend/<path/to/file> root@47.99.136.241:/opt/NoteFlow/backend/<path/to/file>
```

服务器复制到运行中的后端容器并重启：

```bash
docker cp /opt/NoteFlow/backend/<path/to/file> noteflow-backend:/app/<path/to/file>
docker restart noteflow-backend
```

### 6.3 前端静态文件发布

先在本地构建，再上传并复制新的 `dist`。不要删除旧静态资源目录：

```bash
# 本地
tar -czf /tmp/noteflow-frontend-dist-$(date +%Y%m%d%H%M%S).tar.gz -C NoteFlow_frontend dist
scp /tmp/noteflow-frontend-dist-*.tar.gz root@47.99.136.241:/tmp/

# 服务器；将文件名替换为实际上传的文件
mkdir -p /tmp/noteflow-frontend-dist
tar -xzf /tmp/<实际上传的压缩包>.tar.gz -C /tmp/noteflow-frontend-dist
docker cp /tmp/noteflow-frontend-dist/dist/. noteflow-frontend:/usr/share/nginx/html/
docker restart noteflow-frontend
```

浏览器仍显示旧页面时，先硬刷新并核对 `/welcome` 返回的 JS bundle 是否来自本次构建。

## 7. 支付宝配置和测试边界

### 7.1 检查配置是否存在

只输出 `SET` / `MISSING`，不要输出值：

```bash
for name in ALIPAY_APP_ID ALIPAY_PRIVATE_KEY_PATH ALIPAY_PUBLIC_KEY_PATH ALIPAY_NOTIFY_URL ALIPAY_RETURN_URL ALIPAY_SANDBOX; do
  docker exec noteflow-backend sh -c "test -n \"\${$name}\" && echo \"$name=SET\" || echo \"$name=MISSING\""
done
docker exec noteflow-backend sh -c 'test -r "$ALIPAY_PRIVATE_KEY_PATH" && echo private_key=READABLE || echo private_key=MISSING; test -r "$ALIPAY_PUBLIC_KEY_PATH" && echo alipay_public_key=READABLE || echo alipay_public_key=MISSING'
```

生产回调地址必须是：

```text
https://www.noteflow.vip/payment/alipay/return
https://www.noteflow.vip/api/billing/notify/alipay
```

### 7.2 不扣款的联调

可以在后端容器内使用假的订单对象调用 SDK 生成支付 URL，只验证：

- SDK 能读取应用私钥和支付宝公钥；
- URL 使用正式网关 `https://openapi.alipay.com/gateway.do`；
- 网关能够返回页面；
- 回跳地址可访问。

不要把完整签名 URL 写入日志。空的异步通知请求返回 `fail` 是预期行为，因为它没有合法签名。

### 7.3 真实付款

只有用户明确同意后才可进行真实扫码付款。真实成功必须同时观察支付宝异步通知验签、订单号匹配、金额匹配和系统订单状态更新，不能只凭浏览器跳转或前端提示判断成功。AI 不得擅自发起真实扣款、退款，也不得擅自修改支付宝开放平台配置。

## 8. 外层网关和 HTTPS

正常 NoteFlow 发布不需要修改 `/opt/website`。只有用户明确要求修改域名转发时，才检查并重启外层网关：

```bash
docker exec website-web-1 nginx -t
docker restart website-web-1
```

修改网关前必须备份相关配置，并确认 `www.noteflow.vip` 的 HTTP/HTTPS 都仍然代理到 NoteFlow 入口。不要为了修复应用代码问题反复改 Nginx 或证书。

## 9. 上线验证清单

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -fsS https://www.noteflow.vip/api/sys_health
curl -k -sS -o /dev/null -w 'root_http=%{http_code}\n' https://www.noteflow.vip/
curl -k -sS -o /dev/null -w 'welcome_http=%{http_code}\n' https://www.noteflow.vip/welcome
docker logs --since 5m noteflow-backend 2>&1 | tail -100
docker logs --since 5m noteflow-nginx 2>&1 | tail -100
```

健康接口至少应包含 `backend=ok`、`ffmpeg=ok`、`db=ok`。如果页面白屏：

1. 检查 `/welcome` 是否返回 200；
2. 从 HTML 提取 `/assets/` 文件并检查其状态码；
3. 检查浏览器控制台运行时错误；
4. 确认前端容器已复制本次构建产物；
5. 查看后端和 Nginx 最近 5 分钟日志。

相关 API 也要按本轮变更验证，例如视频搜索、订单创建、支付宝回调入口。视频搜索这类外部依赖接口应设置合理超时；不能只因为请求等待很久就宣称部署成功。

## 10. 回滚

- 代码：使用上一版已验证的 Git commit 或静态构建产物，重新构建/复制并重启对应容器。
- SQL：优先执行明确、经过确认的逆向 SQL；复杂迁移按备份制定恢复方案。
- 配置：恢复部署前保存的服务器专用配置，不覆盖用户的 `.env` 和 secrets。
- 数据卷：除非用户明确确认且已有可用备份，否则绝不执行 `docker compose down -v`。

不得用 `git reset --hard` 作为常规回滚手段，因为服务器工作区可能包含正式环境专用改动。

## 11. AI 最终报告模板

部署结束后必须报告以下内容：

```text
Git commit：<commit>
远程同步：<是否等于 origin/main>
数据库备份：<服务器路径和文件大小>
SQL：<文件名、sql_rowcount、核对结果；未执行则说明原因>
容器状态：<mysql/backend/frontend/nginx>
健康检查：<sys_health 结果摘要>
页面检查：<首页和 /welcome 状态码>
支付检查：<配置 / 签名 / 网关 / 真实付款中的实际范围>
未完成事项：<没有则写“无”>
回滚方式：<对应 commit、备份或逆向 SQL>
```

最终回复不得包含密码、私钥、完整 `.env`、完整支付 URL 或带敏感字段的长日志。
