# 支付宝电脑网站支付改造设计

## 1. 目标与范围

将 NoteFlow 当前支付宝“当面付/预创建二维码”流程改为支付宝“电脑网站支付”流程，覆盖：

- 电力充值；
- Pro 会员订阅；
- 两类订单均由后端根据已配置的套餐或会员方案计算固定金额；
- 两类订单共用同一套订单创建、跳转、异步通知、订单查询和结算逻辑。

本次不改造微信支付，不开放前端自定义金额，也不接入支付宝个人收款码。生产访问地址统一使用 `https://www.noteflow.vip`，不依赖当前不可用的 `https://api.noteflow.vip`。

## 2. 现状与问题

当前支付宝通道通过 `alipay.trade.precreate` 生成二维码。该接口属于当面付场景，与用户已经申请的“电脑网站支付”产品不匹配。

电脑网站支付应使用 `alipay.trade.page.pay`：后端根据订单信息生成带签名的支付宝收银台 URL，前端跳转到该 URL；支付完成后，支付宝通过异步通知告知后端，后端校验并完成订单结算。浏览器同步返回只用于展示结果和刷新订单状态，不能作为发放权益的依据。

## 3. 后端设计

### 3.1 支付宝通道

在 `AlipayChannel` 中增加电脑网站支付 URL 生成能力：

- 调用 SDK 的 `api_alipay_trade_page_pay`；
- 传入后端订单号 `out_trade_no`、订单描述 `subject`、后端计算出的 `total_amount`；
- 使用配置的 `ALIPAY_NOTIFY_URL` 和 `ALIPAY_RETURN_URL`；
- 根据沙箱配置选择支付宝网关；
- 返回完整的支付宝网关 URL，不保存这个 URL 到订单表。

支付 URL 是带签名的临时支付请求，金额和订单号必须来自数据库中的订单，不能接受前端传入金额覆盖。

保留现有二维码能力用于微信和 MOCK 通道，支付宝电脑网站支付不再生成 `qrcode_url`。

### 3.2 统一订单服务

抽取一个“为已有支付宝待支付订单生成支付地址”的订单服务方法，创建订单和重新支付都调用它：

- 创建充值订单：使用充值套餐服务端金额；
- 创建订阅订单：使用会员方案服务端金额；
- 重新支付：只允许当前用户自己的 `PENDING + ALIPAY` 订单；
- 重新支付不接受金额、套餐或会员方案参数，只根据已有订单重新签名；
- 已支付、已关闭、已取消或非支付宝订单直接拒绝。

订单创建接口继续返回订单基础信息，并在支付宝电脑网站支付场景下附带本次请求生成的 `payment_url`。

新增接口：

```text
POST /api/billing/order/{order_no}/pay/alipay
```

该接口返回新的 `payment_url`，供账单页对待支付订单发起再次支付。支付地址不落库，因此每次重新支付都会生成新的签名 URL。

### 3.3 接口返回字段

在订单响应中增加可选字段：

```json
{
  "payment_url": "https://openapi.alipay.com/gateway.do?..."
}
```

`payment_url` 只在支付宝电脑网站支付的创建订单或重新支付响应中返回；微信仍返回 `qrcode_url`，MOCK 行为保持兼容。后端不向前端返回应用私钥，也不把私钥写入日志或接口响应。

### 3.4 异步通知安全校验

保留现有支付宝异步通知路由：

```text
POST https://www.noteflow.vip/api/billing/notify/alipay
```

在签名校验成功后，结算前额外校验：

- `out_trade_no` 对应订单存在；
- 通知中的 `app_id` 与当前配置一致；
- 通知中的 `total_amount` 与订单金额一致；
- `trade_status` 为 `TRADE_SUCCESS` 或 `TRADE_FINISHED`。

只有全部校验通过后，才调用现有幂等结算逻辑。重复通知不会重复增加电力或重复开通会员。

## 4. 前端设计

### 4.1 支付弹窗

`PayDialog` 按支付方式区分展示：

- 支付宝：不再展示二维码，显示订单金额和“前往支付宝支付”按钮；点击后跳转 `payment_url`；
- 微信：继续展示现有二维码轮询流程；
- MOCK：保留现有开发测试行为。

支付宝跳转前不允许用户编辑金额。

### 4.2 账单页重新支付

账单页遇到支付宝待支付订单时，调用新的重新支付接口获取最新 `payment_url`，再打开支付宝支付弹窗。微信订单继续使用已有二维码字段。

### 4.3 支付宝同步返回页

新增支付宝返回页路由：

```text
/payment/alipay/return
```

页面从 URL 中读取订单号，仅用于查询订单；不根据 URL 参数直接判定支付成功。页面调用现有订单查询接口轮询短时间，按后端订单状态展示：

- `PAID`：提示支付成功，并刷新用户电力/会员状态；
- `PENDING`：提示支付结果确认中，并提供返回账单或手动刷新；
- 其他状态：提示订单未完成。

支付宝的同步返回地址配置为：

```text
https://www.noteflow.vip/payment/alipay/return
```

## 5. 配置与域名

更新配置模板和部署说明，生产环境使用：

```dotenv
ALIPAY_APP_ID=你的支付宝应用AppID
ALIPAY_PRIVATE_KEY_PATH=/绝对路径/alipay_private_key.pem
ALIPAY_PUBLIC_KEY_PATH=/绝对路径/alipay_public_key.pem
ALIPAY_SANDBOX=false
ALIPAY_NOTIFY_URL=https://www.noteflow.vip/api/billing/notify/alipay
ALIPAY_RETURN_URL=https://www.noteflow.vip/payment/alipay/return
```

其中：

- `ALIPAY_PRIVATE_KEY_PATH` 指应用私钥文件；
- `ALIPAY_PUBLIC_KEY_PATH` 指支付宝公钥文件；
- 应用公钥只需上传到支付宝开放平台，不作为后端验签公钥；
- `.txt` 文件只要内容是 PEM 格式即可改为 `.pem`，路径必须指向实际文件；
- 私钥文件放在服务器受保护目录，不提交 Git，不粘贴到聊天中。

前端生产环境使用同源 API：

```text
VITE_API_BASE_URL=/api
```

部署层需要让 `https://www.noteflow.vip/api/...` 反向代理到 FastAPI 的 8483 端口，并保证站点使用有效 HTTPS 证书。整个改造不使用 `api.noteflow.vip`。

## 6. 测试与验收

增加或更新测试覆盖：

1. 支付宝订单调用 `api_alipay_trade_page_pay`，生成包含订单号和固定金额的支付 URL；
2. 前端不能通过支付接口修改订单金额；
3. 充值和订阅均使用服务端套餐金额，并走同一套支付宝支付地址逻辑；
4. 待支付支付宝订单可以重新生成支付 URL，其他用户或非待支付订单不能生成；
5. 支付宝异步通知金额不匹配时不会结算；
6. 重复异步通知保持幂等；
7. 前端构建、Lint 和后端相关 pytest 通过；
8. 沙箱验收完成后，将 `ALIPAY_SANDBOX=false` 切换到生产环境，并用小额真实订单验证异步通知和权益到账。

## 7. 非目标

- 本次不修改微信支付申请、微信二维码或微信回调；
- 不支持用户输入任意金额；
- 不实现退款、分账、自动续费；
- 不把支付宝支付 URL 持久化为订单字段；
- 不把任何密钥加入代码仓库或发送给开发者。
