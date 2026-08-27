from __future__ import annotations

from pathlib import Path
import sys
import gdown

FILES = {
    "network_flows.csv": "1-tN7atyeCqNoh24jTL0a-OeKNWu8G4ST",
    "security_alerts.csv": "1o5zllVCRhh3v3XvqTKl4lK8BN-wDJg9k",
    "file_access.csv": "1Knt4-1-4F11LjCvuYWg_FkTDA7EZJbAB",
    "identity_context.csv": "1eohym_mhdVNoTFjF3okrGe0m0CRvj4HL",
    "endpoint_events.csv": "1bBPhowhc5uSAoLycPr1OIfJB1UfQjp1v",
    "cloud_activity.csv": "1ufW0E-k73i_9sAW6JstsH2UlRZWEUKMZ",
    "authentication_logs.csv": "1ok0Ns3UFXYvv_aTgqUfX7cc_5grFqBk5",
    "asset_inventory.csv": "1VZwmITG1hu3peYXDs1hUpFzq3GWsTVF9",
}


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    data_dir = root / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    print(f"Descargando datasets en: {data_dir}")
    for filename, file_id in FILES.items():
        target = data_dir / filename
        if target.exists() and target.stat().st_size > 0:
            print(f"[OK] {filename} ya existe ({target.stat().st_size / 1024 / 1024:.1f} MB)")
            continue

        print(f"[DESCARGA] {filename}")
        url = f"https://drive.google.com/uc?id={file_id}"
        result = gdown.download(url=url, output=str(target), quiet=False, fuzzy=True)
        if not result or not target.exists():
            print(f"[ERROR] No se pudo descargar {filename}")
            return 1

    print("\nListo. Los 8 datasets están disponibles en data/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
