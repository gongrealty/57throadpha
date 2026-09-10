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
import time
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


# --- Waking the base station ------------------------------------------------
# The X-Sense cloud only holds a "last reported" snapshot per sensor. Left alone
# that snapshot goes stale for hours; the phone app looks live because, when you
# open it, it sends an "appTempData" request that tells the base station to start
# reporting current readings. A passive read never sends that, so it re-reads the
# same frozen value. We replicate the app's request here (over HTTP, via the same
# shadow-update the app publishes over MQTT), then poll until the value refreshes.
WAKE_SHADOW = "2nd_apptempdata"   # shadow the app writes to trigger live reporting
WAKE_TIMEOUT_MIN = "5"            # ask the station to keep reporting for 5 minutes
POLL_TRIES = 8                    # how many times to re-read after waking
POLL_DELAY_S = 3                  # seconds between re-reads (max ~24s of waiting)


def wake_station(x, station):
    """Send the app's 'appTempData' request so the base station reports live."""
    device_sns = [d.sn for d in station.devices.values()]
    payload = {"state": {"desired": {
        "shadow": "appTempData",
        "deviceSN": device_sns,
        "timeoutM": WAKE_TIMEOUT_MIN,
        "stationSN": station.sn,
        "userId": getattr(x, "userid", "") or "",
        "time": datetime.now().strftime("%Y%m%d%H%M%S"),
    }}}
    return x.do_thing(station, WAKE_SHADOW, payload)


def _temps(station):
    """Current temp per device sn -- used to detect when a fresh read lands."""
    return {dev.sn: (dev.data or {}).get("temperature") for dev in station.devices.values()}


def collect():
    x = XSense()
    x.init()
    x.login(env("XSENSE_EMAIL"), env("XSENSE_PASSWORD"))
    x.load_all()

    rows = []
    for house in x.houses.values():
        for station in house.stations.values():
            # First read: primes the device list and captures the starting
            # (possibly stale) values so we can tell when fresh data arrives.
            try:
                x.get_state(station)
            except Exception as err:  # noqa: BLE001
                print(f"WARN: could not read station {station.sn}: {err}")
                continue

            before = _temps(station)
            print(f"station {station.sn} ({station.type}) before wake: {before}")

            # Wake the base station, then poll until the readings change.
            try:
                res = wake_station(x, station)
                print(f"  wake sent to {len(before)} device(s); response: {str(res)[:200]}")
            except Exception as err:  # noqa: BLE001
                print(f"  WARN: wake request failed: {err}")

            for attempt in range(POLL_TRIES):
                time.sleep(POLL_DELAY_S)
                try:
                    x.get_state(station)
                except Exception as err:  # noqa: BLE001
                    print(f"  poll {attempt + 1}: read error {err}")
                    continue
                now = _temps(station)
                changed = any(now.get(sn) != before.get(sn) for sn in now)
                secs = (attempt + 1) * POLL_DELAY_S
                print(f"  poll {attempt + 1} (+{secs}s): {now}" + ("  <-- refreshed" if changed else ""))
                if changed:
                    break

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
