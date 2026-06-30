"""Add DATA_DIR import to mcp.py"""
path = '/root/hippocampus/src/mcp.py'
with open(path) as f:
    content = f.read()

old = 'from decay_engine import calculate_score'
new = 'from decay_engine import calculate_score\nfrom config import DATA_DIR'
content = content.replace(old, new)

with open(path, 'w') as f:
    f.write(content)
print('import added')
