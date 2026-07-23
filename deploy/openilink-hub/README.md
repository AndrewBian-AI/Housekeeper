# 本地微信接入验证

这套配置在 Mac 上启动三个服务：

- OpenILink Hub：连接微信并收发消息。
- integration-gateway：只允许访问 Housekeeper 的微信接入路径。
- cloudflared：创建临时 HTTPS 公网地址，不需要路由器端口映射。

## 1. 启动

请先确认主项目 Housekeeper 正在运行，然后在终端进入本目录：

```bash
cd deploy/openilink-hub
docker compose up -d
docker compose ps
```

首次启动需要下载镜像，可能需要等待几分钟。

## 2. 获取临时公网地址

```bash
docker compose logs cloudflared --tail=100
```

在输出中找到形如下面的地址：

```text
https://随机字符.trycloudflare.com
```

这个地址是临时的。重新创建 cloudflared 容器后可能变化，变化后需要同步更新
Housekeeper 的“系统公网地址”和 OpenILink Hub 中的应用配置。

## 3. Housekeeper 系统设置

- Hub 地址：`http://host.docker.internal:9800`
- 系统公网地址：上一步获得的 `https://随机字符.trycloudflare.com`

保存后，外部只可访问以下路径：

- `/manifest.json`
- `/oauth/setup`
- `/oauth/redirect`
- `/hub/webhook`

账本登录页和管理接口不会通过这个入口开放。

## 4. 打开 Hub

在 Mac 浏览器访问：

```text
http://localhost:9800
```

按照 Hub 页面提示创建管理员并扫码连接微信。当前版本可在「开发者」中创建
Housekeeper 私有应用：

1. 创建应用，名称可填写「家庭管理系统」。
2. 在「事件订阅」中填写
   `https://你的临时域名/hub/webhook`，验证通过后订阅
   `message.text` 和 `message.image`。
3. 在「OAuth 权限」中仅启用 `message:read` 和 `message:write`。
4. 在「安装管理」中选择已连接的 Bot，Handle 填写 `housekeeper` 并安装。

安装生成的 `app_token`、Webhook Secret 和真实 UUID 均为敏感信息，不要发到聊天、
截图或提交到 Git。Housekeeper 必须保存安装凭证后才能校验 Webhook 和发送回复。

实际使用时，在微信里打开扫码后出现的 **ClawBot 会话**，直接发送 `/help` 或记账
内容；不需要让另一个好友给扫码微信号发消息，也不需要输入 `@housekeeper`。

## 5. 停止与恢复

停止微信接入服务：

```bash
docker compose stop
```

恢复微信接入服务：

```bash
docker compose start
```

仅停止这套服务不会删除 Hub 数据。不要手动删除本目录的 `data` 文件夹。

## 使用边界

Cloudflare Quick Tunnel 适合验证，不保证地址固定或持续可用。完成观察期后，应改用
固定域名的正式 Tunnel，再作为长期微信入口。
