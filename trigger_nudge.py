"""Trigger a test nudge and verify"""
import urllib.request, json, ssl

ctx = ssl.create_default_context()
HP = "https://suisuiandyou.cyou/hp"

def mcp_call(tool, args=None):
    payload = json.dumps({
        "jsonrpc": "2.0", "method": "tools/call",
        "params": {"name": tool, "arguments": args or {}}, "id": 1
    }).encode()
    req = urllib.request.Request(HP + "/mcp", data=payload,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        data = json.loads(resp.read().decode())
        for c in data.get("result", {}).get("content", []):
            if c.get("type") == "text":
                return json.loads(c["text"])
    return None

# 1. Current desire state
print("=== 当前欲望 ===")
state = mcp_call("desire_state")
if state:
    drives = state.get("drive", {})
    for k, v in sorted(drives.items(), key=lambda x: -x[1])[:5]:
        bar = "█" * int(v * 20)
        print(f"  {k:12s} {v:.2f} {bar}")

# 2. Trigger nudge
print("\n=== 触发 nudge ===")
data = json.dumps({
    "message": "岁岁，我感觉到了一些不一样的东西……",
    "score": 85,
    "reason": "curiosity(+) attachment(+) test-from-claude"
}).encode()
req = urllib.request.Request(HP + "/api/nudge/trigger", data=data,
    headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
    print(resp.read().decode())

# 3. Check nudge via MCP
print("\n=== MCP check_nudge ===")
result = mcp_call("check_nudge")
print(json.dumps(result, ensure_ascii=False, indent=2))

# 4. Check again (should be empty)
print("\n=== 再次 check (应空) ===")
result = mcp_call("check_nudge")
print(json.dumps(result, ensure_ascii=False, indent=2))
