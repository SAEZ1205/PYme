from pathlib import Path
from cybershield import CyberShieldEngine

ROOT = Path(__file__).resolve().parent
engine = CyberShieldEngine(ROOT / "data")
missing = engine.missing_files()

if missing:
    print("Faltan datasets:")
    for name in missing:
        print(" -", name)
    print("\nEjecuta primero: python scripts\\download_data.py")
    raise SystemExit(1)

print("Cargando datasets y construyendo baseline...")
engine.load()
summary = engine.summary()
print("\n=== CYBERSHIELD SUMMARY ===")
for key, value in summary.items():
    print(f"{key}: {value:,}" if isinstance(value, int) else f"{key}: {value}")

print("\n=== TOP 10 INVESTIGACIONES ===")
cases = engine.cases(10)
cols = ["case_id", "risk_level", "risk_score", "confidence_score", "identity_id", "username", "sources", "signal_types"]
print(cases[cols].to_string(index=False))
