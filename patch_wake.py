"""Patch wake_scheduler.py to use nudge API instead of Bridge tunnel"""
import re

path = '/root/wake_scheduler.py'
with open(path, 'r') as f:
    content = f.read()

# 1. Replace OC_URL with NUDGE_API
old_oc = 'OC_URL    = "http://127.0.0.1:18080/api/conversations/f27e22f6-ad8f-4f1c-91e9-45ae1964dd70/messages"'
new_oc = 'NUDGE_API  = "https://suisuiandyou.cyou/hp/api/nudge/trigger"'
if old_oc in content:
    content = content.replace(old_oc, new_oc)
    print("OC_URL replaced")
else:
    print("WARN: OC_URL not found exactly - trying fuzzy match")
    # Try regex
    content = re.sub(r'OC_URL\s*=\s*"[^"]*"', 'NUDGE_API  = "https://suisuiandyou.cyou/hp/api/nudge/trigger"', content)
    print("fuzzy replace done")

# 2. Replace push_message function
old_push = 'def push_message(text):\n    payload = json.dumps({"parts":[{"type":"text","text":text}]})\n    req = urllib.request.Request(OC_URL, data=payload.encode(),\n        headers={"Content-Type":"application/json"})\n    urllib.request.urlopen(req, timeout=10)'

new_push = 'def push_message(text, score=0, reason=""):\n    """Send nudge via hippocampus API (no more Bridge tunnel)"""\n    payload = json.dumps({"message": text, "score": score, "reason": reason})\n    req = urllib.request.Request(NUDGE_API, data=payload.encode(),\n        headers={"Content-Type":"application/json"})\n    try:\n        urllib.request.urlopen(req, timeout=10)\n        return True\n    except Exception as e:\n        print(f"  Nudge push err: {e}")\n        return False'

if old_push in content:
    content = content.replace(old_push, new_push)
    print("push_message replaced")
else:
    print("WARN: push_message exact match failed, trying simpler")
    # Just find def push_message and replace the body
    start = content.find('def push_message(text):')
    if start > 0:
        end = content.find('\ndef ', start + 1)
        if end < 0:
            end = content.find('\ndef', start + 1)
        if end < 0:
            end = len(content)
        content = content[:start] + new_push + content[end:]
        print("push_message replaced (fuzzy)")

# 3. Update push_message call
old_call = 'push_message(msg)'
new_call = 'push_message(msg, score, reason)'
content = content.replace(old_call, new_call)
print("call updated")

with open(path, 'w') as f:
    f.write(content)

print('wake_scheduler.py patched OK')
