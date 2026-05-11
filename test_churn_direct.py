#!/usr/bin/env python3
"""Direct test of churn module to find the exact error."""

import sys
sys.path.insert(0, 'd:\\Repositorios\\BI-Ventas\\backend')

from datetime import date
from app.config import get_settings
from app.database.snowflake_connector import connector
from app.routers import churn
import pandas as pd
import numpy as np

cfg = get_settings()

# Test _fetch_features directly
print("=== Testing _fetch_features ===")
try:
    df = churn._fetch_features(cfg, 2026, True)
    print(f"OK: Retrieved {len(df)} rows")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

print("\n=== Testing churn logic ===")
try:
    ano = 2026
    today = date.today()
    ref_mes = today.month if ano == today.year else 12
    
    # churn label
    df["churn_real"] = ((df["ventas_prev"] > 0) & (df["meses_cur"] < 2)).astype(int)
    
    # score heuristic
    prob_churn = churn._score_heuristic(df, ref_mes).values
    
    # Add prob_churn column
    df["prob_churn"] = prob_churn
    
    # Categorize risk
    df["riesgo"] = pd.cut(
        df["prob_churn"],
        bins=[-0.001, 0.35, 0.65, 1.001],
        labels=["Bajo", "Medio", "Alto"],
    ).astype(str)
    
    print(f"OK: All transformations done")
    
    # Sort and limit
    df = df.sort_values("prob_churn", ascending=False).head(200)
    print(f"OK: Sorted and limited to {len(df)} rows")
    
    # Calculate variation
    print("\n=== Testing variation calculation ===")
    variacion = (df["ventas_cur"] / df["ventas_prev"].replace(0, float("nan")) - 1)
    print(f"OK: Variation calculated. Sample: {variacion.head().tolist()}")
    
    # Build records
    print("\n=== Building records ===")
    records = []
    for i, (_, r) in enumerate(df.iterrows()):
        var = variacion.iloc[i]
        print(f"Row {i}: vendedor={r['vendedor']}, var={var}")
        records.append({
            "vendedor":       str(r["vendedor"]),
            "ventas_cur":     round(float(r["ventas_cur"]), 2),
            "ventas_prev":    round(float(r["ventas_prev"]), 2),
            "meses_cur":      int(r["meses_cur"]),
            "meses_prev":     int(r["meses_prev"]),
            "last_mes":       int(r["last_mes"]),
            "variacion_yoy":  round(float(var) * 100, 1) if pd.notna(var) else None,
            "prob_churn":     round(float(r["prob_churn"]) * 100, 1),
            "riesgo":         r["riesgo"],
        })
        if i >= 2:
            break
    
    print(f"\nOK: Built {len(records)} records successfully")
    print(f"Sample record: {records[0]}")
    
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

print("\n=== All tests passed ===")


