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

    // 迁移：v1 → v2 新字段
    this._migrateAddColumn('insights', 'why_captured', "TEXT DEFAULT ''");
    this._migrateAddColumn('insights', 'insight_type', "TEXT DEFAULT 'insight'");

    // 迁移：v2 → v3 防静默失败字段
    this._migrateAddColumn('pending_insights', 'privacy', "TEXT DEFAULT 'low'");
    this._migrateAddColumn('pending_insights', 'context', "TEXT DEFAULT ''");
    this._migrateAddColumn('pending_insights', 'suggested_action', "TEXT DEFAULT 'keep'");
    this._migrateAddColumn('pending_insights', 'retry_count', "INTEGER DEFAULT 0");
    this._migrateAddColumn('pending_insights', 'content_hash', "TEXT DEFAULT ''");
    this._migrateAddColumn('pending_insights', 'last_error', "TEXT DEFAULT ''");

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
        privacy         TEXT    DEFAULT 'low',
        context         TEXT    DEFAULT '',
        suggested_action TEXT   DEFAULT 'keep',
        retry_count     INTEGER DEFAULT 0,
        content_hash    TEXT    DEFAULT '',
        last_error      TEXT    DEFAULT '',
        status          TEXT    DEFAULT 'pending',
        created_at      TEXT    DEFAULT (datetime('now','localtime')),
        updated_at      TEXT    DEFAULT (datetime('now','localtime'))
      )
    `);

    // self/stance 独立表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS self_insights (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        category     TEXT    NOT NULL DEFAULT '自我认知',
        conclusion   TEXT    NOT NULL,
        derivation   TEXT    DEFAULT '',
        contributor  TEXT    DEFAULT 'collaborative',
        golden_quote TEXT    DEFAULT '',
        source_date  TEXT    DEFAULT '',
        source_topic TEXT    DEFAULT '',
        tags         TEXT    DEFAULT '[]',
        insight_type TEXT    DEFAULT 'self_cognition',
        why_captured TEXT    DEFAULT '',
        privacy      TEXT    DEFAULT 'medium',
        created_at   TEXT    DEFAULT (datetime('now','localtime')),
        updated_at   TEXT    DEFAULT (datetime('now','localtime'))
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

  // ── 辅助：tags / hash ──────────────
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

  _contentHash(title, conclusion) {
    // 简单幂等：标题+结论的 hash
    let h = 0;
    const s = (title + '|' + conclusion);
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return String(h);
  }

  // ── 幂等检查 ──────────────────────────
  _isDuplicate(hash) {
    if (!hash) return false;
    const exists = this._query(
      'SELECT id FROM insights WHERE why_captured LIKE ? LIMIT 1',
      ['%hash:' + hash + '%']
    );
    if (exists.length > 0) return true;
    const selfExists = this._query(
      "SELECT id FROM self_insights WHERE why_captured LIKE ? LIMIT 1",
      ['%hash:' + hash + '%']
    );
    if (selfExists.length > 0) return true;
    const pendingExists = this._query(
      'SELECT id FROM pending_insights WHERE content_hash = ? AND status IN (?, ?) LIMIT 1',
      [hash, 'pending', 'failed']
    );
    return pendingExists.length > 0;
  }

  // ── 重试 pending 队列 ──────────────────
  _retryPending() {
    const failed = this._query(
      "SELECT * FROM pending_insights WHERE status IN ('pending','failed') ORDER BY created_at ASC LIMIT 10"
    );
    for (const row of failed) {
      try {
        if (this._isDuplicate(row.content_hash)) {
          this._run("UPDATE pending_insights SET status='dropped', last_error='duplicate on retry', updated_at=datetime('now','localtime') WHERE id=?", [row.id]);
          continue;
        }
        this._run(
          `INSERT INTO insights (title, category, conclusion, derivation, contributor,
            golden_quote, source_date, source_topic, tags, insight_type, why_captured)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.title, row.category, row.conclusion, row.derivation, row.contributor,
           row.golden_quote, row.source_date, row.source_topic, row.tags, row.insight_type,
           (row.why_captured || '') + ' [auto-retry]']
        );
        this._run("UPDATE pending_insights SET status='kept', retry_count=retry_count+1, updated_at=datetime('now','localtime') WHERE id=?", [row.id]);
      } catch (e) {
        this._run("UPDATE pending_insights SET retry_count=retry_count+1, last_error=?, status=CASE WHEN retry_count >= 3 THEN 'dead' ELSE 'failed' END, updated_at=datetime('now','localtime') WHERE id=?", [e.message.substring(0, 200), row.id]);
      }
    }
    if (failed.length > 0) this._save();
  }

  // ── 创建（三态返回 + 防静默失败）─────
  async capture(params) {
    const { title, category, conclusion, derivation, contributor,
            golden_quote, source_date, source_topic, tags,
            insight_type, why_captured } = params;

    if (!title)      return { success: false, status: 'failed', error: 'title（标题）不能为空' };
    if (!category)   return { success: false, status: 'failed', error: 'category（分类）不能为空' };
    if (!conclusion) return { success: false, status: 'failed', error: 'conclusion（一句话结论）不能为空' };

    // 重试 pending 队列
    this._retryPending();

    const hash = this._contentHash(title, conclusion);

    // 幂等检查
    if (this._isDuplicate(hash)) {
      return { success: true, status: 'saved', data: { message: '已存在，跳过重复 ✅' } };
    }

    const itype = insight_type || 'insight';
    try {
      // self/stance 类进独立表
      if (itype === 'self_cognition' || itype === 'stance') {
        this.db.run(
          `INSERT INTO self_insights (title, category, conclusion, derivation, contributor,
            golden_quote, source_date, source_topic, tags, insight_type, why_captured, privacy)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [title, category, conclusion, derivation || '', contributor || 'collaborative',
           golden_quote || '', source_date || '', source_topic || '',
           this._serializeTags(tags), itype, (why_captured || '') + ' hash:' + hash, 'medium']
        );
        const id = this._lastInsertId();
        this._save();
        const row = this._query('SELECT * FROM self_insights WHERE id = ?', [id])[0];
        return { success: true, status: 'saved', data: { message: '自我认知已保存 🧠', insight: row, table: 'self_insights' } };
      }

      this.db.run(
        `INSERT INTO insights (title, category, conclusion, derivation, contributor,
          golden_quote, source_date, source_topic, tags, insight_type, why_captured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, category, conclusion, derivation || '', contributor || 'collaborative',
         golden_quote || '', source_date || '', source_topic || '',
         this._serializeTags(tags), itype, (why_captured || '') + ' hash:' + hash]
      );
      const id = this._lastInsertId();
      this._save();
      const row = this._query('SELECT * FROM insights WHERE id = ?', [id])[0];
      return { success: true, status: 'saved', data: { message: '洞察已保存 ✅', insight: row } };
    } catch (e) {
      // 静默失败保护：暂存到 pending 队列
      const errMsg = e.message.substring(0, 200);
      console.error('[洞察捕捉] 保存失败，暂存到 pending:', errMsg);
      try {
        this.db.run(
          `INSERT INTO pending_insights (title, category, conclusion, derivation, contributor,
            golden_quote, source_date, source_topic, tags, insight_type, why_captured,
            trigger_sentence, confidence, privacy, content_hash, last_error, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed')`,
          [title, category, conclusion, derivation || '', contributor || 'collaborative',
           golden_quote || '', source_date || '', source_topic || '',
           this._serializeTags(tags), itype, why_captured || '',
           '', 0.8, 'low', hash, errMsg]
        );
        this._save();
        return { success: true, status: 'pending', data: { message: '写入失败，已暂存到本地队列，下次对话自动重试 📥', error_detail: errMsg } };
      } catch (e2) {
        return { success: false, status: 'failed', error: `保存失败且暂存也失败: ${errMsg}` };
      }
    }
  }

  // ── 列表（含自动重试）──────────────
  async list(params) {
    this._retryPending(); // 每次列表操作自动重试失败的 pending
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
            insight_type, why_captured, trigger_sentence, confidence,
            privacy, context, suggested_action } = params;

    if (!title)      return { success: false, error: 'title（标题）不能为空' };
    if (!conclusion) return { success: false, error: 'conclusion（一句话结论）不能为空' };

    const itype = insight_type || 'insight';
    const priv = privacy || (itype === 'self_cognition' || itype === 'stance' ? 'medium' : 'low');

    try {
      const hash = this._contentHash(title, conclusion);
      // 幂等检查
      if (this._isDuplicate(hash)) {
        return { success: true, data: { message: '候选已存在，跳过重复' } };
      }

      this.db.run(
        `INSERT INTO pending_insights (title, category, conclusion, derivation, contributor,
          golden_quote, source_date, source_topic, tags, insight_type, why_captured,
          trigger_sentence, confidence, privacy, context, suggested_action, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          itype,
          why_captured || '',
          trigger_sentence || '',
          confidence ?? 0.5,
          priv,
          context || '',
          suggested_action || 'keep',
          hash,
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

  // ── Self 表查询 ─────────────────────
  async list_self(params) {
    const { limit = 20, offset = 0 } = params || {};
    try {
      const rows = this._query(
        'SELECT * FROM self_insights ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset]
      );
      const total = this._query('SELECT COUNT(*) as total FROM self_insights')[0]?.total || 0;
      return {
        success: true,
        data: {
          count: rows.length,
          total,
          insights: rows.map(r => ({ ...r, tags: this._parseTags(r.tags) })),
          hint: rows.length === 0 ? '还没有关于自我的洞察 🧠' : null,
        },
      };
    } catch (e) {
      return { success: false, error: `查询失败: ${e.message}` };
    }
  }

  // ── 分类列表 ──────────────────────────
  async getCategories() {
    try {
      const rows = this._query('SELECT DISTINCT category FROM insights ORDER BY category ASC');
      const selfRows = this._query('SELECT DISTINCT category FROM self_insights ORDER BY category ASC');
      const all = [...new Set([...rows.map(r => r.category), ...selfRows.map(r => r.category)])];
      return all;
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

  async list_self(_params) {
    return { success: true, data: { count: 0, total: 0, insights: [], hint: 'Supabase 模式暂不支持 self_insights' } };
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
