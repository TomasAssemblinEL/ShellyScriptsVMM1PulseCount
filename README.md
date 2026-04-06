# ShellyScriptsVMM1PulseCount

Shelly script for VMM1 pulse counting.  
Counts input toggles and publishes the running total via MQTT.

## Files

| File | Description |
|------|-------------|
| `pulse_count.js` | Main Shelly script |

## Configuration (`pulse_count.js`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER` | `192.168.1.82` | MQTT broker IP |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_TOPIC` | `shelly/vmm1/pulsecount` | Publish topic |
| `INPUT_ID` | `0` | Shelly input to monitor |
| `PUBLISH_INTERVAL_MS` | `5000` | Publish interval (ms) |

## MQTT Payload Example

```json
{
  "device": "VMM1",
  "input": 0,
  "pulse_count": 142,
  "ts": 1744052400
}
```

## Setup

1. Open the Shelly web UI → Scripts → Add script.  
2. Paste the contents of `pulse_count.js`.  
3. Save and enable the script.  
4. Ensure MQTT is enabled in Shelly Settings → MQTT with broker `192.168.1.82:1883`.
