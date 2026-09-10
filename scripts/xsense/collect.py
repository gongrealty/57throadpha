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
# it goes stale for hours; the phone app looks live because, on open, it connects
# to X-Sense's MQTT broker and publishes an "appTempData" request telling the base
# station to report live for a few minutes. A plain HTTP read never sends that
# (and the request is REFUSED over HTTP -- "Forbidden"; it only works over MQTT),
# so it re-reads the frozen value. So we briefly join the same MQTT broker the app
# uses, publish that request per station, then poll the HTTP read until it refreshes.
WAKE_TIMEOUT_MIN = "5"     # ask each station to keep reporting for 5 minutes
POLL_TRIES = 10            # times to re-read after waking
POLL_DELAY_S = 3           # seconds between re-reads (max ~30s of waiting)


def _temps(station):
    """Current temp per device sn -- used to detect when a fresh read lands."""
    return {dev.sn: (dev.data or {}).get("temperature") for dev in station.devices.values()}


def _wake_payload(x, station):
    return {"state": {"desired": {
        "shadow": "appTempData",
        "deviceSN": [d.sn for d in station.devices.values()],
        "timeoutM": WAKE_TIMEOUT_MIN,
        "stationSN": station.sn,
        "userId": getattr(x, "userid", "") or "",
        "time": datetime.now().strftime("%Y%m%d%H%M%S"),
    }}}


def _wake_topic(x, station):
    # Reuse the library's own thing-name logic: the URL get_state reads is
    # https://<region>.x-sense-iot.com/things/<thing>/shadow?name=2nd_mainpage,
    # so <thing> is the exact name to address over MQTT too.
    url, _ = x._thing_request(station, "2nd_mainpage")
    thing = url.split("/things/", 1)[1].split("/shadow", 1)[0]
    return f"$aws/things/{thing}/shadow/name/2nd_apptempdata/update"


def wake_house(x, house):
    """Join X-Sense's MQTT broker and publish the appTempData request for each
    station, the same way the app does. Best-effort: any failure is logged and
    swallowed so the HTTP read still runs."""
    mh = house.mqtt                      # MQTTHelper: presigned WS client, TLS preset
    mh.prepare_connect()
    mh.client.connect(house.mqtt_server, 443)
    mh.client.loop_start()
    try:
        time.sleep(1.5)                  # let the connection settle
        for station in house.stations.values():
            topic = _wake_topic(x, station)
            info = mh.client.publish(topic, json.dumps(_wake_payload(x, station)), qos=0)
            print(f"  wake -> {topic}  (rc={getattr(info, 'rc', '?')})")
        time.sleep(2)                    # let the publishes flush
    finally:
        mh.client.loop_stop()
        try:
            mh.client.disconnect()
        except Exception:  # noqa: BLE001
            pass


def collect():
    x = XSense()
    x.init()
    x.login(env("XSENSE_EMAIL"), env("XSENSE_PASSWORD"))
    x.load_all()

    rows = []
    for house in x.houses.values():
        # First pass: prime each station's device list and record the starting
        # (possibly stale) values so we can tell when fresh data arrives.
        before = {}
        for station in house.stations.values():
            try:
                x.get_state(station)
            except Exception as err:  # noqa: BLE001
                print(f"WARN: could not read station {station.sn}: {err}")
                continue
            before[station.sn] = _temps(station)
            print(f"station {station.sn} ({station.type}) before wake: {before[station.sn]}")

        # Wake every station in the house over MQTT (the app's channel).
        try:
            wake_house(x, house)
        except Exception as err:  # noqa: BLE001
            print(f"WARN: MQTT wake failed ({err}); falling back to a plain read")

        # Poll the HTTP read until the values refresh.
        for station in house.stations.values():
            if station.sn not in before:
                continue
            for attempt in range(POLL_TRIES):
                time.sleep(POLL_DELAY_S)
                try:
                    x.get_state(station)
                except Exception as err:  # noqa: BLE001
                    print(f"  poll {attempt + 1} ({station.sn}): read error {err}")
                    continue
                now = _temps(station)
                changed = any(now.get(sn) != before[station.sn].get(sn) for sn in now)
                secs = (attempt + 1) * POLL_DELAY_S
                print(f"  poll {attempt + 1} (+{secs}s) {station.sn}: {now}" + ("  <-- refreshed" if changed else ""))
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
