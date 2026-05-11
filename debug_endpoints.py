#!/usr/bin/env python3
"""Debug endpoints to see actual error messages."""

import requests
import json
from datetime import date

BASE = "http://127.0.0.1:8000/api"
TOKEN = None

# Login
try:
    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@alico.com", "password": "Alico2024!"})
    if r.status_code == 200:
        TOKEN = r.json()["access_token"]
        print(f"[OK] Login → token obtained")
    else:
        print(f"[ERROR] Login failed: {r.status_code} - {r.text}")
        exit(1)
except Exception as e:
    print(f"[ERROR] Login exception: {e}")
    exit(1)

headers = {"Authorization": f"Bearer {TOKEN}"}

# Test Churn
print("\n=== TESTING CHURN ===")
try:
    r = requests.get(f"{BASE}/churn?ano={date.today().year}", headers=headers)
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.headers.get('content-type')}")
    print(f"Raw Response: {r.text[:500]}")
    if r.status_code == 200:
        data = r.json()
        print(f"OK: {len(data.get('data', []))} records")
    else:
        print(f"ERROR: {r.status_code}")
except Exception as e:
    print(f"Exception: {e}")

# Test Cross-Selling
print("\n=== TESTING CROSS-SELLING ===")
try:
    r = requests.get(f"{BASE}/cross-selling?ano={date.today().year}", headers=headers)
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.headers.get('content-type')}")
    print(f"Raw Response: {r.text[:500]}")
    if r.status_code == 200:
        data = r.json()
        print(f"OK: {len(data.get('data', []))} rules")
    else:
        print(f"ERROR: {r.status_code}")
except Exception as e:
    print(f"Exception: {e}")
