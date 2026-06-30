#!/usr/bin/env node
// ═══════════════════════════════════════════════════
// 洞察捕捉 Web 面板（不含 MCP，纯浏览）
// 启动后浏览器打开 http://localhost:3456 浏览洞察
// ═══════════════════════════════════════════════════

import 'dotenv/config';

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createStorage } from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const storage = await createStorage();
const app = express();
const PORT = parseInt(process.env.PORT || '3456', 10);

app.use(express.json());

// ── 静态文件：前端页面 ──────────────────
app.use(express.static(join(__dirname, 'ui')));

// ── API: 获取分类列表 ───────────────────
app.get('/api/categories', async (_req, res) => {
  try {
    const cats = await storage.getCategories();
    res.json(cats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: 列出洞察 ──────────────────────
app.get('/api/insights', async (req, res) => {
  try {
    const { category, limit, offset } = req.query;
    const result = await storage.list({
      category: category || undefined,
      limit:    parseInt(limit) || 20,
      offset:   parseInt(offset) || 0,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── API: 搜索洞察 ──────────────────────
app.get('/api/insights/search', async (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: '缺少搜索关键词 q' });
    const result = await storage.search({
      query: q,
      limit: parseInt(limit) || 20,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 启动服务器 ─────────────────────────
app.listen(PORT, () => {
  console.log(`\n🪨  洞察捕捉 Web 面板已启动`);
  console.log(`   打开浏览器访问: http://localhost:${PORT}\n`);
});
