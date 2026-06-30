# 🪨 Insight（洞察捕捉）

让 AI 在深度对话中识别有价值的洞察，自动保存下来。AI 检测到高价值时刻 → 征求你确认 → 保存 → 随时打开浏览器翻看。

---

## 这是什么

你跟 AI 聊到深处会碰撞出很好的东西——一个新的视角、一句精准的金句、或者对自己的一次诚实观察。但说完就没了。

这个工具让 AI 帮你抓住这些瞬间，自动识别、确认后保存，事后随时翻看。

---

## 怎么跑

### 1. 下载

```bash
git clone https://github.com/pipsqueakkk0613/insight.git
cd insight
npm install
```

### 2. 启动

```bash
npm start
```

看到这个就成功了：

```
🪨  洞察捕捉 (Insight) 已启动
  MCP 接入:  http://localhost:3456/mcp
  MCP 接入:  http://localhost:3456/sse
  Web 面板:  http://localhost:3456/
```

### 3. 接入 MCP 客户端

在橙子聊天（或其他 MCP 客户端）里添加 MCP 服务器：

| 字段 | 值 |
|------|-----|
| 类型 | `SSE` |
| URL | `http://localhost:3456/sse` |
| 名称 | 洞察捕捉 |

> 手机和电脑不在同一台设备？连同一个 WiFi，把 `localhost` 换成电脑的局域网 IP（`192.168.x.x`）。  
> Windows 需要放行防火墙端口：`netsh advfirewall firewall add rule name="Insight MCP" dir=in action=allow protocol=TCP localport=3456`

---

## 怎么填 .env

复制 `.env.example` 为 `.env`，改你自己的配置。不填也能跑，默认存本地文件。

```ini
# 不填默认 SQLite，数据在 data/ 目录下
STORAGE_TYPE=sqlite

# 要云同步就填 Supabase（去 supabase.com 注册建个项目）
# STORAGE_TYPE=supabase
# SUPABASE_URL=https://你的项目.supabase.co
# SUPABASE_ANON_KEY=你的anon_key
```

> Supabase 建表语句见项目里的 `.env.example`。

---

## 五个 AI 工具

| 工具 | 做什么 |
|------|--------|
| `capture_insight` | 保存洞察，AI 检测到高价值时刻调用 |
| `list_insights` | 列出洞察，可筛选分页 |
| `search_insights` | 搜索洞察 |
| `update_insight` | 修改洞察 |
| `delete_insight` | 删除洞察 |

---

## Web 面板

浏览器打开 `http://localhost:3456/` 浏览、搜索已保存的洞察。

只想要面板不要 MCP：`npm run web`

---

## 致谢 & 授权

- 💡 灵感来源 & 授权：小红书 **东方苍龙DG十二双足力健**（小红书号：scwClaude1010）
- 🔧 二改 & MCP 化：**岁岁**（小红书号：18608548721）

MIT License
