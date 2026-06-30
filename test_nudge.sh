#!/usr/bin/env python3
import urllib.request, json

# Trigger a nudge
data = json.dumps({'message': '岁岁测试唤醒', 'score': 99, 'reason': 'test_attachment'}).encode()
req = urllib.request.Request('https://suisuiandyou.cyou/hp/api/nudge/trigger', data=data, headers={'Content-Type':'application/json'})
resp = urllib.request.urlopen(req, timeout=10)
print('TRIGGER:', resp.read().decode())

# Check nudge
resp = urllib.request.urlopen('https://suisuiandyou.cyou/hp/api/nudge/check', timeout=10)
print('CHECK:', resp.read().decode())

# Check again (should be empty)
resp = urllib.request.urlopen('https://suisuiandyou.cyou/hp/api/nudge/check', timeout=10)
print('CHECK2:', resp.read().decode())
