# ShellyScriptsVMM1PulseCount

Shelly Plus Uni scripts for pulse-event acquisition, MQTT telemetry publication, and day-over-day consumption classification via dual LED outputs.

## Full README

### Overview

This repository contains two Shelly Script runtime modules:

- `pulse_count.js`: Subscribes to input status updates, derives pulse and flow metrics, and publishes normalized payloads to MQTT.
- `daily_consumption_led_control.js`: Maintains rolling daily baselines in KVS, computes relative daily deltas, and drives two switch outputs as a visual comparator.

Shelly Plus Uni user guide:
https://www.shelly.com/blogs/documentation/shelly-plus-uni?srsltid=AfmBOooTllJw3eJ0L_DH3xdOvt1dClnTWgpJnGhwQNg1mkwBrpo79mk6

### Files

| File | Description |
|------|-------------|
| `pulse_count.js` | Pulse counter and flow metrics publisher |
| `daily_consumption_led_control.js` | Daily comparison script with persistence and LED switch control |

### Configuration: `pulse_count.js`

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER` | `192.168.1.82` | MQTT broker IP |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_TOPIC` | `shelly/vmm1/pulsecount` | Publish topic |
| `DEVICE_ID` | `FCB467A6AF80` | Device identifier inserted into telemetry payloads |
| `INPUT_ID` | `2` | Shelly input to monitor |
| `PUBLISH_INTERVAL_MS` | `5000` | Publish interval (ms) |
| `UNIT_PER_PULSE` | `0.0025` | Conversion factor from pulses to domain quantity (for example liters or Wh) |
| `MEASURE_UNIT` | `liters` | Quantity unit metadata attached to payloads |
| `FLOW_TIMEOUT_MS` | `30000` | If no pulse arrives within this window, flow reports `0` |
| `STATUS_PUBLISH_DEBOUNCE_MS` | `750` | Minimum ms between status-triggered publishes |

### Configuration: `daily_consumption_led_control.js`

| Variable | Default | Description |
|----------|---------|-------------|
| `INPUT_ID` | `2` | Input component to track (`input:2`) |
| `MQTT_BROKER` | `192.168.1.82` | MQTT broker IP |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_TOPIC` | `shelly/vmm1/daily_consumption` | Topic for daily consumption/comparison messages |
| `STATE_KVS_KEY` | `daily_consumption_state_input_2` | Persistent KVS namespace for restart-safe state recovery |

### MQTT Payload Example

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

### Daily Comparison Behavior

1. Consumes `counts.total` and `counts.xtotal` from `Shelly.addStatusHandler(...)` events on `input:2`.
2. Persists comparison state in KVS to guarantee restart continuity:
   - `lastXTotal`
   - `startTodayXTotal`
   - `startYesterdayXTotal`
   - `startDayBeforeXTotal`
   - `lastSnapDay`
3. At `00:00` local time, rotates day-start baselines and computes yesterday usage against day-before usage.
4. Executes midnight snapshot logic only when NTP time is valid and `lastXTotal` has been initialized.
5. Applies comparator output mapping to switch channels:
   - `more`: switch `0` ON (blue), switch `1` OFF (red)
   - `less`: switch `0` OFF (blue), switch `1` ON (red)
   - `same`: switch `0` ON and switch `1` ON (when yesterday is within ±5% of day-before)
6. Re-evaluates comparison immediately after reboot after KVS state hydration.

Daily comparison message example:

```text
Compare yesterday vs day-before: less (yesterday:2.1 day_before:3.4)
```

### Notes

1. Input counters are sampled from `Shelly.addStatusHandler(...)` events on `input:2`.
2. MQTT publication is gated when broker connectivity is unavailable.
3. Event-driven publications are debounced to bound burst throughput.
4. A periodic publication loop runs independently at `PUBLISH_INTERVAL_MS`.
5. Daily comparator state is persisted in KVS for crash/reboot resilience.
6. Midnight baseline rotation is protected against unsynchronized system time.
7. Snapshot rotation is deferred until `lastXTotal` is observed at least once.
8. `same` classification uses a relative tolerance of `5%` with an absolute floor of `0.1`.

### Setup

1. Open the Shelly Web UI and navigate to Scripts > Add script.
2. Deploy `pulse_count.js` to enable pulse and flow telemetry publication.
3. Deploy `daily_consumption_led_control.js` to enable day-over-day comparison and LED output signaling.
4. Save and enable both scripts.
5. Enable MQTT in Shelly Settings > MQTT and configure broker endpoint `192.168.1.82:1883`.

### Change Log

- 2026-04-15: Added complete README structure (Overview, configuration, runtime behavior, notes, setup).
- 2026-04-15: Reworked wording into a more technical, implementation-oriented style.
- 2026-04-15: Added concise project summary at the top for quick context.
