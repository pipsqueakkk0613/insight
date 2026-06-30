"""Precisely add check_nudge tool to mcp.py"""
import re

path = '/root/hippocampus/src/mcp.py'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find positions
tools_start = None
tools_end = None
calm_tool_end = None
calm_handler_end = None

for i, line in enumerate(lines):
    # Find the tools list start: TOOLS = [
    if line.strip().startswith('TOOLS = ['):
        tools_start = i
    # Find the tools list end: ]
    if tools_start and not tools_end:
        if line.strip() == ']':
            tools_end = i

    # Track calm tool end (for reference)
    if '"desire_calm"' in line:
        # This is the calm tool definition start
        pass

# Find the last tool definition closing (},) before the closing ]
if tools_start and tools_end:
    for i in range(tools_end - 1, tools_start, -1):
        stripped = lines[i].strip()
        if stripped in ('},', '}'):
            calm_tool_end = i
            break

# Find the calm handler
calm_handler_line = None
for i, line in enumerate(lines):
    if 'elif name == "desire_calm":' in line:
        calm_handler_line = i

# Find end of calm handler (next elif/else/return or blank line + non-indented)
calm_handler_end = None
indent_level = None
for i in range(calm_handler_line + 1, len(lines)):
    line = lines[i]
    stripped = line.strip()
    if not stripped:
        continue
    if indent_level is None:
        indent_level = len(line) - len(line.lstrip())
    current_indent = len(line) - len(line.lstrip())
    # A top-level statement (def, elif, class, etc.) ends the handler
    if current_indent <= indent_level - 4 or stripped.startswith('elif ') or stripped.startswith('else:') or stripped.startswith('def '):
        calm_handler_end = i
        break

if calm_handler_end is None:
    calm_handler_end = len(lines)

print(f"tools: {tools_start}..{tools_end}, calm_tool_end: {calm_tool_end}")
print(f"calm_handler: {calm_handler_line}..{calm_handler_end}")

# === 1. Add tool definition to the tools list ===
new_tool_def = '''    {
        "name": "check_nudge",
        "description": "检查是否有待处理的唤醒提醒（由自动唤醒调度器触发）。返回唤醒消息、评分和触发原因。调用后提醒会被消费掉。",
        "inputSchema": {"type": "object", "properties": {}}
    },
'''

# Insert BEFORE the closing bracket of the last tool (before '},' then ']')
# Find the last '},' before the closing ']'
insert_before = None
for i in range(tools_end - 1, tools_start, -1):
    if lines[i].strip() == '},':
        insert_before = i + 1  # After this line
        break
    elif lines[i].strip() == '}':
        # Need to add comma
        lines[i] = '    },\n'
        insert_before = i + 1
        break

if insert_before is None:
    # Fallback: insert before closing ]
    insert_before = tools_end

lines.insert(insert_before, new_tool_def)
print(f"tool inserted at line {insert_before}")

# Recalculate handler positions after insertion
calm_handler_line += 1  # Because we inserted one line
calm_handler_end += 1

# === 2. Add handler code ===
new_handler = '''
        elif name == "check_nudge":
            nudge_path = DATA_DIR / "pending_nudge.json"
            if nudge_path.exists():
                with open(nudge_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                os.remove(nudge_path)
                return {"content": [{"type": "text", "text": json.dumps({"has_nudge": True, "nudge": data}, ensure_ascii=False, indent=2)}]}
            return {"content": [{"type": "text", "text": json.dumps({"has_nudge": False, "nudge": None}, ensure_ascii=False)}]}
'''

lines.insert(calm_handler_end, new_handler)
print(f"handler inserted after line {calm_handler_end}")

# Write back
with open(path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

# === Verify ===
with open(path, 'r') as f:
    content = f.read()

# Check tool list is valid Python
check_count = content.count('"check_nudge"')
print(f"check_nudge in file: {check_count} times")

# Quick syntax check
try:
    compile(content, path, 'exec')
    print("Python syntax OK")
except SyntaxError as e:
    print(f"SYNTAX ERROR: {e}")
