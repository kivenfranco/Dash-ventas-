import requests
import json

token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJhZG1pbkBhbGljby5jb20iLCJub21icmUiOiJBZG1pbmlzdHJhZG9yIiwicm9sIjoiYWRtaW4iLCJjb2RpZ29fdmVuZGVkb3IiOm51bGwsImV4cCI6MTc3ODAzNDIwNn0.2DOx2FeqUnEZFzEXmynZDywrR1CnTzLg6GZU7NGMnyM'
headers = {'Authorization': f'Bearer {token}'}

endpoints = [
    ('RFM', 'http://localhost:8000/api/rfm?ano=2026'),
    ('Churn', 'http://localhost:8000/api/churn?ano=2026'),
    ('ABC/XYZ', 'http://localhost:8000/api/abcxyz?ano=2026'),
    ('Cross-Selling', 'http://localhost:8000/api/cross-selling?ano=2026'),
]

print("=" * 60)
print("TESTING ENDPOINTS")
print("=" * 60)

for name, url in endpoints:
    try:
        r = requests.get(url, headers=headers, timeout=15)
        status = "OK" if r.status_code == 200 else f"ERROR {r.status_code}"
        data = r.json()
        records = len(data.get("data", []))
        print(f"[{status}] {name:20} -> {records} registros")
    except Exception as e:
        print(f"[ERROR] {name:20} -> {str(e)[:50]}")

print("=" * 60)
