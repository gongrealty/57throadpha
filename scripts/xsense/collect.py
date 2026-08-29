"""
Reads every X-Sense sensor on the account and stores one row per sensor
in Supabase. Designed to run on a schedule from GitHub Actions.

Required environment variables (GitHub repo secrets):
  XSENSE_EMAIL, XSENSE_PASSWORD
  SUPABASE_URL              e.g. https://abcdefgh.supabase.co
  SUPABASE_SERVICE_ROLE_KEY
"""
import os
import sys
import json
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone

try:  # only needed on machines that re-sign HTTPS traffic
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from xsense import XSense

RETENTION_DAYS = 400


def env(name):
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: missing environment variable {name}")
        sys.exit(1)
    return val


def supabase(method, path, body=None, extra_headers=None):
    url = f"{env('SUPABASE_URL').rstrip('/')}/rest/v1/{path}"
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, res.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8")


def collect():
    x = XSense()
    x.init()
    x.login(env("XSENSE_EMAIL"), env("XSENSE_PASSWORD"))
    x.load_all()

    rows = []
    for house in x.houses.values():
        for station in house.stations.values():
            try:
                x.get_state(station)
            except Exception as err:  # noqa: BLE001
                print(f"WARN: could not read station {station.sn}: {err}")
                continue

            for device in station.devices.values():
                d = device.data or {}
                if d.get("temperature") is None:
                    continue  # not a thermo-hygrometer; skip
                rows.append({
                    "house": house.name,
                    "station_sn": station.sn,
                    "device_id": device.entity_id,
                    "device_name": device.name,
                    "model": device.type,
                    "temp_c": d.get("temperature"),
                    "humidity": d.get("humidity"),
                    "battery": d.get("batInfo"),
                    "rf_level": d.get("rfLevel"),
                    "online": bool(device.online),
                })
    return rows


def main():
    rows = collect()
    if not rows:
        print("No sensor readings found -- nothing written.")
        return 1

    status, text = supabase(
        "POST", "gr_sensor_readings", rows,
        {"Prefer": "return=minimal"},
    )
    if status >= 300:
        print(f"ERROR: Supabase insert failed ({status}): {text}")
        return 1

    for r in rows:
        f = r["temp_c"] * 9 / 5 + 32 if r["temp_c"] is not None else None
        print(f"  {r['device_name']}: {r['temp_c']}C / {f:.1f}F, {r['humidity']}% RH")
    print(f"Wrote {len(rows)} reading(s).")

    # Trim old rows so the table can never creep toward the size limit.
    # PostgREST filters take literal values, not SQL expressions, so the
    # cutoff is computed here and passed as a timestamp.
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    query = urllib.parse.urlencode({"ts": f"lt.{cutoff.isoformat()}"})
    status, text = supabase(
        "DELETE", f"gr_sensor_readings?{query}",
        None, {"Prefer": "return=minimal"},
    )
    if status >= 300:
        print(f"WARN: retention cleanup failed ({status}): {text}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
