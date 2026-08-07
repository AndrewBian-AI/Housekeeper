# 微信接入服务

这套配置在 Mac 上启动三个服务：

- OpenILink Hub：连接微信并收发消息。
- integration-gateway：只允许访问 Housekeeper 的微信接入路径。
- cloudflared：通过固定域名的 Cloudflare Tunnel 提供 HTTPS 入口，不需要路由器端口映射。

## 1. 配置固定隧道

在 Cloudflare Zero Trust 中创建远程管理的 Tunnel，并在连接器页面选择 Docker。
复制页面命令中 `--token` 后面的 Token，但不要把 Token 发给他人或提交到 Git。

在本目录的 `.env` 文件末尾增加：

```text
CLOUDFLARE_TUNNEL_TOKEN=你的Tunnel-Token
```

在 Tunnel 的 Public Hostname 中配置：

- 子域名：`wechat`
- 域名：你在 Cloudflare 中托管的域名
- 服务类型：`HTTP`
- URL：`http://integration-gateway:80`

## 2. 启动

请先确认主项目 Housekeeper 正在运行，然后在终端进入本目录：

```bash
cd deploy/openilink-hub
docker compose up -d
docker compose ps
```

首次启动需要下载镜像，可能需要等待几分钟。

## 3. 验证固定公网地址

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://wechat.你的域名/manifest.json
curl -s -o /dev/null -w "%{http_code}\n" https://wechat.你的域名/
```

第一条应返回 `200`，第二条应返回 `404`。这说明公网只能进入微信接入所需的路径，
没有暴露账本登录页。

## 4. Housekeeper 系统设置

- Hub 地址：`http://host.docker.internal:9800`
- 系统公网地址：`https://wechat.你的域名`

保存后，外部只可访问以下路径：

- `/manifest.json`
- `/oauth/setup`
- `/oauth/redirect`
- `/hub/webhook`

账本登录页和管理接口不会通过这个入口开放。

## 5. 打开 Hub

在 Mac 浏览器访问：

```text
http://localhost:9800
```

按照 Hub 页面提示创建管理员并扫码连接微信。当前版本可在「开发者」中创建
Housekeeper 私有应用：

1. 创建应用，名称可填写「家庭管理系统」。
2. 在「事件订阅」中填写
   `http://integration-gateway:80/hub/webhook`，验证通过后订阅
   `message.text` 和 `message.image`。Hub 与接入网关位于同一个 Compose 网络时，
   使用内部地址可避免消息绕行公网；Housekeeper 的“系统公网地址”仍使用固定 HTTPS 域名。
3. 在「OAuth 权限」中仅启用 `message:read` 和 `message:write`。
4. 在「安装管理」中选择已连接的 Bot，Handle 填写 `housekeeper` 并安装。

安装生成的 `app_token`、Webhook Secret 和真实 UUID 均为敏感信息，不要发到聊天、
截图或提交到 Git。Housekeeper 必须保存安装凭证后才能校验 Webhook 和发送回复。

实际使用时，在微信里打开扫码后出现的 **ClawBot 会话**，直接发送 `/help` 或记账
内容；不需要让另一个好友给扫码微信号发消息，也不需要输入 `@housekeeper`。

## 6. 停止与恢复

停止微信接入服务：

```bash
docker compose stop
```

恢复微信接入服务：

```bash
docker compose start
```

仅停止这套服务不会删除 Hub 数据。不要手动删除本目录的 `data` 文件夹。

固定 Tunnel 的域名不会因为容器重启或网络重连而变化。Mac、Docker Desktop 和这套
Compose 服务仍需保持运行，微信接入才会在线。
