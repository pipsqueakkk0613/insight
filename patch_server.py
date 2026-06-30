"""Patch server.py to add nudge API endpoints"""
import os, sys

path = '/root/hippocampus/src/server.py'
with open(path, 'r') as f:
    content = f.read()

# Find the last import statement
# Add NUDGE_FILE definition and nudge routes before 'if __name__'
nudge_code = '''
# ── Nudge API（自动唤醒，替代 Bridge 隧道）──
NUDGE_FILE = DATA_DIR / "pending_nudge.json"

from pydantic import BaseModel
class NudgePayload(BaseModel):
    message: str = ""
    score: float = 0
    reason: str = ""

@app.post("/api/nudge/trigger")
def api_trigger_nudge(payload: NudgePayload):
    data = {"message": payload.message, "score": payload.score, "reason": payload.reason,
            "timestamp": datetime.now(timezone.utc).isoformat()}
    with open(NUDGE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return {"status": "ok"}

@app.get("/api/nudge/check")
def api_check_nudge():
    if NUDGE_FILE.exists():
        with open(NUDGE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        os.remove(NUDGE_FILE)
        return {"has_nudge": True, "nudge": data}
    return {"has_nudge": False, "nudge": None}
'''

# Insert before 'if __name__'
if "if __name__" in content:
    parts = content.split("if __name__", 1)
    new_content = parts[0] + nudge_code + "\nif __name__" + parts[1]
else:
    new_content = content + nudge_code

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("server.py patched OK")
