# ShellyScriptsVMM1PulseCount

Shelly scripts for pulse counting, daily consumption comparison, and LED output control.

## Files

| File | Description |
|------|-------------|
| `pulse_count.js` | Pulse counter and flow metrics publisher |
| `daily_consumption_led_control.js` | Daily comparison script with persistence and LED switch control |

## Configuration (`pulse_count.js`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER` | `192.168.1.82` | MQTT broker IP |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_TOPIC` | `shelly/vmm1/pulsecount` | Publish topic |
| `DEVICE_ID` | `FCB467A6AF80` | Shelly device ID |
| `INPUT_ID` | `2` | Shelly input to monitor |
| `PUBLISH_INTERVAL_MS` | `5000` | Publish interval (ms) |
| `UNIT_PER_PULSE` | `0.0025` | Quantity per pulse (example liters or Wh) |
| `MEASURE_UNIT` | `liters` | Quantity unit label |
| `FLOW_TIMEOUT_MS` | `30000` | If no pulse within this window, flow reports `0` |
| `STATUS_PUBLISH_DEBOUNCE_MS` | `750` | Minimum ms between status-triggered publishes |

## Configuration (`daily_consumption_led_control.js`)

| Variable | Default | Description |
|----------|---------|-------------|
| `INPUT_ID` | `2` | Input component to track (`input:2`) |
| `MQTT_BROKER` | `192.168.1.82` | MQTT broker IP |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_TOPIC` | `shelly/vmm1/daily_consumption` | Topic for daily consumption/comparison messages |
| `STATE_KVS_KEY` | `daily_consumption_state_input_2` | Persistent KVS key used across restarts |

## MQTT Payload Example

```json
{
  "id": 2,
  "counts": {
    "total": 2303,
    "xtotal": 5.758
  },
  "device": "FCB467A6AF80",
  "quantity_unit": "liters",
  "pulse_frequency_hz": 0,
  "flow_rate_per_hour": 0,
  "avg_flow_rate_per_hour": 12.5,
  "rssi": -63,
  "uptime": 9876,
  "source": "status_total",
  "ts": 1775591220
}
```

## Daily Comparison Behavior (`daily_consumption_led_control.js`)

1. Reads `counts.total` and `counts.xtotal` from `Shelly.addStatusHandler(...)` on `input:2`.
2. Saves state to KVS so values survive restart:
  1. `lastXTotal`
  2. `startTodayXTotal`
  3. `startYesterdayXTotal`
  4. `startDayBeforeXTotal`
  5. `lastSnapDay`
3. At `00:00`, rotates day-start snapshots and compares:
  1. yesterday usage
  2. day-before-yesterday usage
4. Controls LEDs via switches based on direction:
  1. `more` -> switch `0` ON (blue), switch `1` OFF (red)
  2. `less` -> switch `0` OFF (blue), switch `1` ON (red)
  3. `same` -> switch `0` ON, switch `1` ON
5. Re-runs comparison immediately after restart when state is loaded.

### Daily Comparison Message Example

```text
Compare yesterday vs day-before: less (yesterday:2.1 day_before:3.4)
```

## Notes

1. Pulse counts are read from `Shelly.addStatusHandler(...)` on `input:2`.
2. The script skips publish when MQTT is offline.
3. Status-triggered publishes are debounced to reduce burst traffic.
4. A periodic publish still runs every `PUBLISH_INTERVAL_MS`.
5. Daily comparison data is persisted in KVS for restart safety.

## Setup

1. Open the Shelly web UI → Scripts → Add script.  
2. Add `pulse_count.js` if you want pulse and flow metrics publishing.  
3. Add `daily_consumption_led_control.js` for daily comparison + LED control.  
4. Save and enable the scripts.  
5. Ensure MQTT is enabled in Shelly Settings → MQTT with broker `192.168.1.82:1883`.
