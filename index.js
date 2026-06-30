#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// 洞察捕捉 MCP 服务器 (HTTP/SSE 模式)
// 每人自己 npm start 跑起来，自己的数据自己管
//
// MCP 接入: http://localhost:3456/mcp  (新版 Streamable HTTP)
//           http://localhost:3456/sse  (旧版 SSE，兼容老客户端)
// Web 面板: http://localhost:3456/
// ═══════════════════════════════════════════════════

import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createStorage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const storage = await createStorage();
const PORT = parseInt(process.env.PORT || '3456', 10);

// ═══════════════════════════════════════
//  创建 MCP 服务器并注册工具
// ═══════════════════════════════════════
function createMcpServer() {
  const server = new McpServer({
    name: 'insight',
    version: '1.0.0',
  }, {
    capabilities: { logging: {} },
  });

  server.tool(
    'capture_insight',
    `保存一条对话洞察。

⚠️ 调用时机（满足以下任一条件时）：
1. 观点碰撞后的新认知——讨论中一方说出「你说得对」「我没想到这个角度」
2. 模糊直觉被语言精确捕捉——用户一直试图表达的感觉终于说清楚了
3. 拆解到底层逻辑——从表面现象一步步推到根本原因
4. 跨领域类比迁移——一个领域的洞察成功应用到另一个领域
5. 关于关系/自我的清醒认知——对自己行为模式的诚实观察

❌ 不要在日常闲聊、事实查询、工具操作说明中调用。

📋 调用前先征求用户确认：展示摘要，让用户决定是否保存。`,
    {
      title:        z.string().describe('简短标题，直白有记忆点，如「工具是素材不是服务」'),
      category:     z.string().describe('分类名，如「产品思维」「自我认知」「跨领域」'),
      conclusion:   z.string().describe('一句话结论，最精炼的表达'),
      derivation:   z.string().optional().describe('推导过程，3-5句话还原，保留关键转折点'),
      contributor:  z.string().optional().describe('谁的贡献：user、ai、collaborative，默认 collaborative'),
      golden_quote: z.string().optional().describe('原始金句，保留1-2句对话中的精准原话'),
      source_date:  z.string().optional().describe('来源日期，如 2026-07-14'),
      source_topic: z.string().optional().describe('这轮对话的主题关键词'),
      tags:         z.string().optional().describe('标签，逗号分隔'),
    },
    async (params) => {
      const result = await storage.capture(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'list_insights',
    '列出已保存的洞察列表，可按分类筛选、分页',
    {
      category: z.string().optional().describe('按分类筛选，不填则返回全部'),
      limit:    z.number().optional().describe('每页条数，默认 20'),
      offset:   z.number().optional().describe('偏移量，默认 0'),
    },
    async (params) => {
      const result = await storage.list(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'search_insights',
    '按关键词搜索洞察，在标题、结论、金句中搜索',
    {
      query: z.string().describe('搜索关键词'),
      limit: z.number().optional().describe('返回条数，默认 20'),
    },
    async (params) => {
      const result = await storage.search(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'update_insight',
    '修改一条已保存的洞察。只传需要修改的字段。',
    {
      id:           z.number().describe('洞察 ID'),
      title:        z.string().optional().describe('新标题'),
      category:     z.string().optional().describe('新分类'),
      conclusion:   z.string().optional().describe('新结论'),
      derivation:   z.string().optional().describe('新推导过程'),
      golden_quote: z.string().optional().describe('新金句'),
      tags:         z.string().optional().describe('新标签，逗号分隔'),
    },
    async (params) => {
      const result = await storage.update(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'delete_insight',
    '删除一条洞察。删除前应让用户确认。',
    {
      id: z.number().describe('要删除的洞察 ID'),
    },
    async (params) => {
      const result = await storage.delete(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

// ═══════════════════════════════════════
//  创建 HTTP 应用
// ═══════════════════════════════════════
const app = createMcpExpressApp({ host: '0.0.0.0' });
// 注意：createMcpExpressApp 已内置 express.json()，不要再加

// Web 面板静态文件
app.use(express.static(join(__dirname, 'ui')));

// 首页
app.get('/', (_req, res) => {
  res.sendFile(join(__dirname, 'ui', 'index.html'));
});

// 存储活跃的 transport
const transports = {};

// ═══════════════════════════════════════
//  新版: Streamable HTTP (推荐)
//  MCP URL: http://host:port/mcp
// ═══════════════════════════════════════
app.all('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports[sessionId]) {
      const existing = transports[sessionId];
      if (existing instanceof StreamableHTTPServerTransport) {
        transport = existing;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Session exists but uses a different transport' },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      const eventStore = new InMemoryEventStore();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) delete transports[sid];
      };
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[insight] MCP 错误:', error.message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// ═══════════════════════════════════════
//  旧版: HTTP+SSE (兼容老客户端)
//  GET  /sse       建立连接
//  POST /messages  发送消息
// ═══════════════════════════════════════
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;
  res.on('close', () => {
    delete transports[transport.sessionId];
  });
  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport instanceof SSEServerTransport) {
    await transport.handlePostMessage(req, res, req.body);
  } else if (transport) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session uses a different transport' },
      id: null,
    });
  } else {
    res.status(400).json({ error: 'No transport found for sessionId' });
  }
});

// ═══════════════════════════════════════
//  Web 面板 API
// ═══════════════════════════════════════
app.get('/api/categories', async (_req, res) => {
  try {
    res.json(await storage.getCategories());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/insights', async (req, res) => {
  try {
    const { category, limit, offset } = req.query;
    const result = await storage.list({
      category: category || undefined,
      limit: parseInt(limit) || 20,
      offset: parseInt(offset) || 0,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/insights/search', async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: '缺少搜索关键词 q' });
    const result = await storage.search({ query: q, limit: parseInt(limit) || 20 });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════
//  启动
// ═══════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  const storageLabel = process.env.SUPABASE_URL ? 'Supabase 云同步' : '本地 SQLite';
  console.log(`
🪨  洞察捕捉 (Insight) 已启动
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MCP 接入 (推荐):  http://你的IP:${PORT}/mcp
  MCP 接入 (兼容):  http://你的IP:${PORT}/sse
  Web 面板:         http://localhost:${PORT}/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  存储: ${storageLabel}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
});

// 优雅退出
process.on('SIGINT', async () => {
  console.log('\n[insight] 正在关闭...');
  for (const sid in transports) {
    try { await transports[sid].close(); } catch {}
    delete transports[sid];
  }
  process.exit(0);
});
