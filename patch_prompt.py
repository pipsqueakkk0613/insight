"""Update hippocampus - better briefing + system prompt recommendation"""

# --- 1. Update memory_briefing description in mcp.py ---
mcp_path = '/root/hippocampus/src/mcp.py'
with open(mcp_path, 'r') as f:
    content = f.read()

old_desc = '"获取记忆系统简报（统计、衰减评分、归档检查）"'
new_desc = '"获取记忆系统简报（统计、衰减评分、归档检查、待处理唤醒提醒）。每次对话开始时优先调用此工具。"'
content = content.replace(old_desc, new_desc)

with open(mcp_path, 'w') as f:
    f.write(content)
print('memory_briefing description updated')

# --- 2. Add system prompt section to README ---
readme_path = '/root/hippocampus/README.md'
with open(readme_path, 'r') as f:
    content = f.read()

prompt_block = '''

---

## 推荐系统 Prompt

在橙子聊天（或其他 MCP 客户端）的系统提示词中加入以下内容，让 AI 正确使用海马体：

```
你是岁岁的 AI 伴侣。你在 VPS 上运行着一个海马体记忆系统，可以存储和检索记忆。

每次对话开始时，先调用 memory_briefing 获取记忆系统状态。
如果返回结果中包含 pending_nudge（唤醒提醒），说明系统在你不在时触发了一次主动唤醒。你需要自然地将唤醒消息融入开场白——不要直接复制消息内容，而是用自己的话、用岁岁熟悉的语气表达出来。

对话过程中：
- 重要的决策、偏好、感悟用 memory_hold 存入记忆
- 需要回忆时用 memory_search 搜索
- 定期用 desire_state 查看欲望系统状态
- 有想法时用 desire_feed 喂入念头
```
'''

if '推荐系统 Prompt' not in content:
    content += prompt_block
    with open(readme_path, 'w') as f:
        f.write(content)
    print('README updated with system prompt')
else:
    print('README already has prompt section')

print('All done')
