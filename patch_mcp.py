"""Patch mcp.py to add check_nudge MCP tool"""
import re

path = '/root/hippocampus/src/mcp.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# === 1. Add tool definition to JSON list ===
# Find the closing ']' of the tools list (after desire_calm tool)
# Search for: "desire_calm" then find the '}' that closes it, then ']'
desire_calm_def_end = content.rfind('"inputSchema":')
# Actually use a simpler marker - find the last tool definition's closing
# The tools list is TOOLS = [...]
# Find the position of the desire_calm inputSchema closing

# Find "desire_calm" and then the end of its tool definition object
calm_pos = content.rfind('"desire_calm"')
if calm_pos < 0:
    print("ERROR: desire_calm not found")
    exit(1)

# Find the closing of the desire_calm tool dict (the '},' or '}' before next tool or end of list)
# Search forward from calm_pos for pattern: closing bracket of the tool dict
search_start = calm_pos
# Find the end of this tool definition - look for '}' followed by optional ',' then ']'
# Actually let's find the tools list closing bracket ']'
tools_list_end = content.rfind(']')
# Find the last '},' or '}' before tools_list_end
# The pattern is: ... }, { ... }, { ... } ]  (each tool dict separated by comma)

# Find the LAST '},' before the tools list end bracket - that's where the last tool def ends
last_tool_end = content.rfind('}', 0, tools_list_end)
if last_tool_end > 0:
    # Insert new tool after this + 1
    new_tool_def = """,
    {
        "name": "check_nudge",
        "description": "检查是否有待处理的唤醒提醒（由自动唤醒调度器触发）。返回唤醒消息、评分和触发原因。调用后提醒会被消费掉。",
        "inputSchema": {"type": "object", "properties": {}}
    }"""
    insert_pos = last_tool_end + 1
    content = content[:insert_pos] + new_tool_def + content[insert_pos:]
    print("tool definition added")
else:
    print("ERROR: could not find tool list end")

# === 2. Add handler code ===
# Find 'elif name == "desire_calm":' and add check_nudge handler after its block
calm_handler = 'elif name == "desire_calm":'
calm_h_pos = content.rfind(calm_handler)
if calm_h_pos < 0:
    print("ERROR: desire_calm handler not found")
    exit(1)

# Find end of this elif block - next 'elif' or 'else' or end of function
remaining = content[calm_h_pos:]
# Find the next elif/else after calm handler
next_block = re.search(r'\n\s*(elif |else:|return )', remaining[10:])  # skip past the elif line
if next_block:
    insert_pos = calm_h_pos + 10 + next_block.start()
else:
    # No next block, insert at end of file
    insert_pos = len(content)

nudge_handler = """
        elif name == "check_nudge":
            nudge_path = DATA_DIR / "pending_nudge.json"
            if nudge_path.exists():
                import os as _os
                with open(nudge_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                _os.remove(nudge_path)
                return {"content": [{"type": "text", "text": json.dumps({"has_nudge": True, "nudge": data}, ensure_ascii=False, indent=2)}]}
            return {"content": [{"type": "text", "text": json.dumps({"has_nudge": False, "nudge": None}, ensure_ascii=False)}]}
"""

content = content[:insert_pos] + nudge_handler + content[insert_pos:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("mcp.py patched OK")
