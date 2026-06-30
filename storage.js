// ═══════════════════════════════════════════════════
// 洞察捕捉 — 统一存储层
// 自动选择：有 Supabase 配置 → 云同步
//           没有 → 本地 SQLite（零配置，开箱即用）
//  配置写在 .env 文件里（复制 .env.example 改名即可）
// ═══════════════════════════════════════════════════

import 'dotenv/config';
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ── 读取环境变量 ──────────────────────────
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'sqlite';
const DB_PATH      = process.env.DB_PATH || './data/insights.db';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'insights';
const SUPABASE_READY = !!(SUPABASE_URL && SUPABASE_KEY);

// ═══════════════════════════════════════════════════
//  后端 1: SQLite（默认，纯 JS，无需任何安装配置）
// ═══════════════════════════════════════════════════
let _SQL = null; // 缓存初始化后的 SQL 模块

class SQLiteBackend {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
  }

  // ── 工厂：异步创建实例 ────────────────
  static async create() {
    const dbPath = resolve(DB_PATH);
    mkdirSync(dirname(dbPath), { recursive: true });

    if (!_SQL) {
      // 定位 sql.js 的 WASM 文件
      const wasmPath = resolve(dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
      _SQL = await initSqlJs({ locateFile: () => wasmPath });
    }

    let db;
    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new _SQL.Database(buffer);
    } else {
      db = new _SQL.Database();
    }

    const backend = new SQLiteBackend(db, dbPath);
    backend._initTable();
    return backend;
  }

  // ── 建表 + 迁移 ──────────────────────
  _initTable() {
    // 主表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS insights (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        category     TEXT    NOT NULL,
        conclusion   TEXT    NOT NULL,
        derivation   TEXT    DEFAULT '',
        contributor  TEXT    DEFAULT 'collaborative',
        golden_quote TEXT    DEFAULT '',
        source_date  TEXT    DEFAULT '',
        source_topic TEXT    DEFAULT '',
        tags         TEXT    DEFAULT '[]',
        created_at   TEXT    DEFAULT (datetime('now','localtime')),
        updated_at   TEXT    DEFAULT (datetime('now','localtime'))
      )
    `);

    // 迁移：v1 → v2 新字段（忽略 "duplicate column" 错误）
    this._migrateAddColumn('insights', 'why_captured', "TEXT DEFAULT ''");
    this._migrateAddColumn('insights', 'insight_type', "TEXT DEFAULT 'insight'");

    // 候选层
    this.db.run(`
      CREATE TABLE IF NOT EXISTS pending_insights (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT    NOT NULL,
        category        TEXT    NOT NULL DEFAULT '待分类',
        conclusion      TEXT    NOT NULL,
        derivation      TEXT    DEFAULT '',
        contributor     TEXT    DEFAULT 'collaborative',
        golden_quote    TEXT    DEFAULT '',
        source_date     TEXT    DEFAULT '',
        source_topic    TEXT    DEFAULT '',
        tags            TEXT    DEFAULT '[]',
        insight_type    TEXT    DEFAULT 'insight',
        why_captured    TEXT    DEFAULT '',
        trigger_sentence TEXT   DEFAULT '',
        confidence      REAL    DEFAULT 0.5,
        status          TEXT    DEFAULT 'pending',
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        updated_at      TEXT    DEFAULT (datetime('now','localtime'))
      )
    `);

    this._save();
  }

  _migrateAddColumn(table, column, colDef) {
    try { this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`); }
    catch (_) { /* 列已存在，跳过 */ }
  }

  // ── 持久化到磁盘 ──────────────────────
  _save() {
    try {
      writeFileSync(this.dbPath, Buffer.from(this.db.export()));
    } catch (e) {
      console.error('[洞察捕捉] 写入数据库失败:', e.message);
    }
  }

  // ── 执行 SELECT，返回对象数组 ──────────
  _query(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  // ── 执行 INSERT/UPDATE/DELETE ───────────
  _run(sql, params = []) {
    this.db.run(sql, params);
  }

  // ── 获取最后插入的 ID ──────────────────
  _lastInsertId() {
    const result = this.db.exec('SELECT last_insert_rowid()');
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0];
    }
    return null;
  }

  // ── 辅助：tags 处理 ────────────────────
  _parseTags(tagsStr) {
    if (!tagsStr) return [];
    if (Array.isArray(tagsStr)) return tagsStr;
    try { return JSON.parse(tagsStr); } catch { return []; }
  }

  _serializeTags(tags) {
    if (Array.isArray(tags)) return JSON.stringify(tags);
    if (typeof tags === 'string') {
      return JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean));
    }
    return '[]';
  }

  // ── 创建 ──────────────────────────────
  async capture(params) {
    const { title, category, conclusion, derivation, contributor,
            golden_quote, source_date, source_topic, tags,
            insight_type, why_captured } = params;

    if (!title)      return { success: false, error: 'title（标题）不能为空' };
    if (!category)   return { success: false, error: 'category（分类）不能为空' };
    if (!conclusion) return { success: false, error: 'conclusion（一句话结论）不能为空' };

    try {
      this.db.run(
        `INSERT INTO insights (title, category, conclusion, derivation, contributor,
          golden_quote, source_date, source_topic, tags, insight_type, why_captured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          category,
          conclusion,
          derivation || '',
          contributor || 'collaborative',
          golden_quote || '',
          source_date || '',
          source_topic || '',
          this._serializeTags(tags),
          insight_type || 'insight',
          why_captured || '',
        ]
      );
      const id = this._lastInsertId();
      this._save();
      const row = this._query('SELECT * FROM insights WHERE id = ?', [id])[0];
      return { success: true, data: { message: '洞察已保存 ✅', insight: row } };
    } catch (e) {
      return { success: false, error: `保存失败: ${e.message}` };
    }
  }

  // ── 列表 ──────────────────────────────
  async list(params) {
    const { category, insight_type, limit = 20, offset = 0 } = params || {};
    try {
      const conditions = [];
      const queryParams = [];
      const countParams = [];

      if (category) {
        conditions.push('category = ?');
        queryParams.push(category);
        countParams.push(category);
      }
      if (insight_type) {
        conditions.push('insight_type = ?');
        queryParams.push(insight_type);
        countParams.push(insight_type);
      }

      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
      const sql = `SELECT * FROM insights ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const countSql = `SELECT COUNT(*) as total FROM insights ${where}`;

      queryParams.push(limit, offset);

      const rows = this._query(sql, queryParams);
      const countResult = this._query(countSql, countParams);
      const total = countResult.length > 0 ? countResult[0].total : 0;

      return {
        success: true,
        data: {
          count: rows.length,
          total,
          insights: rows.map(r => ({ ...r, tags: this._parseTags(r.tags) })),
          hint: rows.length === 0 ? '还没有洞察，聊点深度话题吧 🎣' : null,
        },
      };
    } catch (e) {
      return { success: false, error: `查询失败: ${e.message}` };
    }
  }

  // ── 搜索 ──────────────────────────────
  async search(params) {
    const { query, limit = 20 } = params || {};
    if (!query || !query.trim()) {
      return { success: false, error: 'query（搜索关键词）不能为空' };
    }
    const q = query.trim();
    const like = `%${q}%`;
    try {
      const rows = this._query(
        `SELECT * FROM insights
         WHERE title LIKE ? OR conclusion LIKE ? OR golden_quote LIKE ?
         ORDER BY created_at DESC LIMIT ?`,
        [like, like, like, limit]
      );

      return {
        success: true,
        data: {
          query: q,
          count: rows.length,
          insights: rows.map(r => ({ ...r, tags: this._parseTags(r.tags) })),
          hint: rows.length === 0 ? `没有找到和「${q}」相关的洞察` : null,
        },
      };
    } catch (e) {
      return { success: false, error: `搜索失败: ${e.message}` };
    }
  }

  // ── 更新 ──────────────────────────────
  async update(params) {
    const { id, title, category, conclusion, derivation, golden_quote, tags } = params;
    if (!id) return { success: false, error: 'id 不能为空' };

    // 检查行是否存在
    const existing = this._query('SELECT id FROM insights WHERE id = ?', [id]);
    if (existing.length === 0) {
      return { success: false, error: `没有找到 ID 为 ${id} 的洞察` };
    }

    const sets = [];
    const vals = [];
    if (title        !== undefined) { sets.push('title = ?');        vals.push(title); }
    if (category     !== undefined) { sets.push('category = ?');     vals.push(category); }
    if (conclusion   !== undefined) { sets.push('conclusion = ?');   vals.push(conclusion); }
    if (derivation   !== undefined) { sets.push('derivation = ?');   vals.push(derivation); }
    if (golden_quote !== undefined) { sets.push('golden_quote = ?'); vals.push(golden_quote); }
    if (tags         !== undefined) { sets.push('tags = ?');         vals.push(this._serializeTags(tags)); }

    if (sets.length === 0) return { success: false, error: '至少需要修改一个字段' };

    sets.push("updated_at = datetime('now','localtime')");
    vals.push(id);

    try {
      this._run(`UPDATE insights SET ${sets.join(', ')} WHERE id = ?`, vals);
      this._save();
      const row = this._query('SELECT * FROM insights WHERE id = ?', [id])[0];
      return { success: true, data: { message: '洞察已更新 ✅', insight: { ...row, tags: this._parseTags(row.tags) } } };
    } catch (e) {
      return { success: false, error: `更新失败: ${e.message}` };
    }
  }

  // ── 删除 ──────────────────────────────
  async delete(params) {
    const { id } = params;
    if (!id) return { success: false, error: 'id 不能为空' };
    try {
      const existing = this._query('SELECT id FROM insights WHERE id = ?', [id]);
      if (existing.length === 0) {
        return { success: false, error: `没有找到 ID 为 ${id} 的洞察` };
      }
      this._run('DELETE FROM insights WHERE id = ?', [id]);
      this._save();
      return { success: true, data: { message: `洞察 #${id} 已删除 🗑️` } };
    } catch (e) {
      return { success: false, error: `删除失败: ${e.message}` };
    }
  }

  // ═══════════════════════════════════
  //  候选层 (Pending)
  // ═══════════════════════════════════

  async capture_pending(params) {
    const { title, category, conclusion, derivation, contributor,
            golden_quote, source_date, source_topic, tags,
            insight_type, why_captured, trigger_sentence, confidence } = params;

    if (!title)      return { success: false, error: 'title（标题）不能为空' };
    if (!conclusion) return { success: false, error: 'conclusion（一句话结论）不能为空' };

    try {
      this.db.run(
        `INSERT INTO pending_insights (title, category, conclusion, derivation, contributor,
          golden_quote, source_date, source_topic, tags, insight_type, why_captured, trigger_sentence, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          category || '待分类',
          conclusion,
          derivation || '',
          contributor || 'collaborative',
          golden_quote || '',
          source_date || '',
          source_topic || '',
          this._serializeTags(tags),
          insight_type || 'insight',
          why_captured || '',
          trigger_sentence || '',
          confidence ?? 0.5,
        ]
      );
      const id = this._lastInsertId();
      this._save();
      const row = this._query('SELECT * FROM pending_insights WHERE id = ?', [id])[0];
      return { success: true, data: { message: '候选洞察已暂存 📥', pending: row } };
    } catch (e) {
      return { success: false, error: `暂存失败: ${e.message}` };
    }
  }

  async review_pending(params) {
    const { limit = 10 } = params || {};
    try {
      const rows = this._query(
        'SELECT * FROM pending_insights WHERE status = ? ORDER BY created_at ASC LIMIT ?',
        ['pending', limit]
      );
      return {
        success: true,
        data: {
          count: rows.length,
          pending: rows.map(r => ({ ...r, tags: this._parseTags(r.tags) })),
          hint: rows.length === 0 ? '没有待确认的候选洞察 ✅' : null,
        },
      };
    } catch (e) {
      return { success: false, error: `查询失败: ${e.message}` };
    }
  }

  async confirm_pending(params) {
    const { id, action } = params; // action: 'keep' | 'merge' | 'drop'
    if (!id) return { success: false, error: 'id 不能为空' };

    try {
      const pending = this._query('SELECT * FROM pending_insights WHERE id = ?', [id])[0];
      if (!pending) return { success: false, error: `没有找到 ID 为 ${id} 的候选洞察` };

      if (action === 'keep') {
        // 确认入库
        await this.capture({
          title: pending.title,
          category: pending.category,
          conclusion: pending.conclusion,
          derivation: pending.derivation,
          contributor: pending.contributor,
          golden_quote: pending.golden_quote,
          source_date: pending.source_date,
          source_topic: pending.source_topic,
          tags: this._parseTags(pending.tags),
          insight_type: pending.insight_type,
          why_captured: pending.why_captured,
        });
        this._run('UPDATE pending_insights SET status = ?, updated_at = datetime(\"now\",\"localtime\") WHERE id = ?', ['kept', id]);
        this._save();
        return { success: true, data: { message: '已确认入库 ✅' } };
      } else if (action === 'merge') {
        // 保留内容但标记为已合并
        this._run('UPDATE pending_insights SET status = ?, updated_at = datetime(\"now\",\"localtime\") WHERE id = ?', ['merged', id]);
        this._save();
        return { success: true, data: { message: '已标记为合并 🔀' } };
      } else {
        // drop — 丢弃
        this._run('UPDATE pending_insights SET status = ?, updated_at = datetime(\"now\",\"localtime\") WHERE id = ?', ['dropped', id]);
        this._save();
        return { success: true, data: { message: '已丢弃 🗑️' } };
      }
    } catch (e) {
      return { success: false, error: `操作失败: ${e.message}` };
    }
  }

  // ═══════════════════════════════════

  // ── 分类列表 ──────────────────────────
  async getCategories() {
    try {
      const rows = this._query('SELECT DISTINCT category FROM insights ORDER BY category ASC');
      return rows.map(r => r.category);
    } catch (e) {
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════
//  后端 2: Supabase（可选，配置后才启用）
// ═══════════════════════════════════════════════════
class SupabaseBackend {
  constructor() {
    this.url   = SUPABASE_URL;
    this.key   = SUPABASE_KEY;
    this.table = SUPABASE_TABLE;
  }

  async _request(method, pathSuffix, body) {
    const headers = {
      'apikey':        this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type':  'application/json',
    };
    if (method === 'POST' || method === 'PATCH') {
      headers['Prefer'] = 'return=representation';
    }
    try {
      const resp = await fetch(
        `${this.url}/rest/v1/${this.table}${pathSuffix}`,
        { method, headers, body: body ? JSON.stringify(body) : undefined }
      );
      if (resp.status === 204) return [];
      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      if (!resp.ok) {
        throw new Error(`Supabase 错误 (${resp.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      }
      return data;
    } catch (e) {
      throw e;
    }
  }

  _toQuery(params) {
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  async capture(params) {
    const { title, category, conclusion, derivation, contributor,
            golden_quote, source_date, source_topic, tags } = params;

    if (!title)      return { success: false, error: 'title（标题）不能为空' };
    if (!category)   return { success: false, error: 'category（分类）不能为空' };
    if (!conclusion) return { success: false, error: 'conclusion（一句话结论）不能为空' };

    const row = {
      title, category, conclusion,
      derivation:   derivation || '',
      contributor:  contributor || 'collaborative',
      golden_quote: golden_quote || '',
      source_date:  source_date || '',
      source_topic: source_topic || '',
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
    };

    try {
      const data = await this._request('POST', '', row);
      return { success: true, data: { message: '洞察已保存 ✅', insight: Array.isArray(data) ? data[0] : data } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async list(params) {
    const { category, limit = 20, offset = 0 } = params || {};
    const path = this._toQuery({
      select: '*',
      order:  'created_at.desc',
      limit,
      offset,
      ...(category ? { category: `eq.${category}` } : {}),
    });
    try {
      const data = await this._request('GET', path);
      const rows = Array.isArray(data) ? data : [];
      return {
        success: true,
        data: { count: rows.length, insights: rows, hint: rows.length === 0 ? '还没有洞察，聊点深度话题吧 🎣' : null },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async search(params) {
    const { query, limit = 20 } = params || {};
    if (!query || !query.trim()) {
      return { success: false, error: 'query（搜索关键词）不能为空' };
    }
    const q = query.trim();
    const orFilter = [`title.ilike.*${q}*`, `conclusion.ilike.*${q}*`, `golden_quote.ilike.*${q}*`].join(',');
    const path = this._toQuery({ select: '*', or: `(${orFilter})`, order: 'created_at.desc', limit });
    try {
      const data = await this._request('GET', path);
      const rows = Array.isArray(data) ? data : [];
      return {
        success: true,
        data: { query: q, count: rows.length, insights: rows, hint: rows.length === 0 ? `没有找到和「${q}」相关的洞察` : null },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async update(params) {
    const { id, title, category, conclusion, derivation, golden_quote, tags } = params;
    if (!id) return { success: false, error: 'id 不能为空' };

    const patch = {};
    if (title        !== undefined) patch.title        = title;
    if (category     !== undefined) patch.category     = category;
    if (conclusion   !== undefined) patch.conclusion   = conclusion;
    if (derivation   !== undefined) patch.derivation   = derivation;
    if (golden_quote !== undefined) patch.golden_quote = golden_quote;
    if (tags         !== undefined) {
      patch.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    if (Object.keys(patch).length === 0) {
      return { success: false, error: '至少需要修改一个字段' };
    }
    patch.updated_at = new Date().toISOString();

    try {
      const path = this._toQuery({ id: `eq.${id}` });
      const data = await this._request('PATCH', path, patch);
      return { success: true, data: { message: '洞察已更新 ✅', insight: Array.isArray(data) ? data[0] : data } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async delete(params) {
    const { id } = params;
    if (!id) return { success: false, error: 'id 不能为空' };
    try {
      const path = this._toQuery({ id: `eq.${id}` });
      await this._request('DELETE', path);
      return { success: true, data: { message: `洞察 #${id} 已删除 🗑️` } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async getCategories() {
    try {
      const path = this._toQuery({ select: 'category', order: 'category.asc' });
      const data = await this._request('GET', path);
      const rows = Array.isArray(data) ? data : [];
      return [...new Set(rows.map(r => r.category))].filter(Boolean);
    } catch {
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════
//  工厂函数：自动选择后端
// ═══════════════════════════════════════════════════
export async function createStorage() {
  const type = (STORAGE_TYPE === 'supabase' && SUPABASE_READY) ? 'supabase' : 'sqlite';

  if (type === 'supabase') {
    console.error('[洞察捕捉] 使用 Supabase 云存储');
    return new SupabaseBackend();
  }

  console.error('[洞察捕捉] 使用本地 SQLite 存储');
  return await SQLiteBackend.create();
}
