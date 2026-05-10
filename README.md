# ShellyScriptsVMM1PulseCount

Shelly Plus Uni scripts for pulse-event acquisition, MQTT telemetry publication, and day-over-day consumption classification via dual LED outputs.

## Full README

### Overview

This repository contains three Shelly Script runtime modules:

- `pulse_count.js`: Subscribes to input status updates, derives pulse and flow metrics, and publishes normalized payloads to MQTT.
- `daily_consumption_led_control.js`: Maintains rolling daily baselines in KVS, computes relative daily deltas, and drives two switch outputs as a visual comparator.
- `MixTankFertilizerController.js`: Controls mix-tank refill and fertilizer dosing with a state-based automation cycle and reboot-safe KVS recovery.

Shelly Plus Uni user guide:
https://www.shelly.com/blogs/documentation/shelly-plus-uni?srsltid=AfmBOooTllJw3eJ0L_DH3xdOvt1dClnTWgpJnGhwQNg1mkwBrpo79mk6

### Files

| File | Description |
|------|-------------|
| `pulse_count.js` | Pulse counter and flow metrics publisher |
| `daily_consumption_led_control.js` | Daily comparison script with persistence and LED switch control |
| `MixTankFertilizerController.js` | Mix-tank refill and fertilizer dosing controller with timed dosing reset and KVS-backed restart recovery |

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

### Configuration: `MixTankFertilizerController.js`

| Variable | Default | Description |
|----------|---------|-------------|
| `LOW_LEVEL_INPUT_ID` | `0` | Low-level tank sensor input. A `true` event requests a refill cycle when the controller is idle. |
| `HIGH_LEVEL_INPUT_ID` | `1` | High-level tank sensor input. A `true` event terminates water fill and starts fertilizer dosing. |
| `WATER_VALVE_SWITCH_ID` | `0` | Output switch that opens/closes the water refill valve. |
| `FERTILIZER_PUMP_SWITCH_ID` | `1` | Output switch that runs the fertilizer dosing pump. |
| `FERTILIZER_TIMEOUT_MS` | `15000` | Maximum fertilizer pump runtime for one dosing cycle. |
| `WATER_FILL_WINDOW_START_HOUR` | `0` | Start hour for permitted automatic refill window. |
| `WATER_FILL_WINDOW_END_HOUR` | `3` | End hour for permitted automatic refill window. |
| `WINDOW_ENFORCE_INTERVAL_MS` | `60000` | Polling interval used to force-stop filling if the time window closes mid-cycle. |
| `NTFY_URL` | `https://ntfy.sh/berg_rud_vaxthus` | Notification endpoint used for operational events. |
| `STATE_KVS_KEY` | `mix_tank_fertilizer_controller_state` | Persistent state key for reboot-safe recovery. |
| `ACTIVE_STATE_VC_KEY` | `text:200` | Virtual text component key that exposes current controller state for integrations such as Home Assistant. |
| `ACTIVE_STATE_VC_ID` | `200` | Virtual text component numeric identifier used when auto-creating the active-state component. |

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
4. Deploy `MixTankFertilizerController.js` to automate mix-tank water fill and fertilizer dosing.
5. Save and enable the scripts you use on your device.
6. Enable MQTT in Shelly Settings > MQTT and configure broker endpoint `192.168.1.82:1883`.

### MixTank Controller Persistence

1. `MixTankFertilizerController.js` stores runtime state in KVS key `mix_tank_fertilizer_controller_state`.
2. On reboot, it restores one of three states: idle, filling water, or dosing fertilizer.
3. If dosing was active, it resumes only for the remaining dosing time when system unix time is valid.
4. If recovery time data is missing or invalid, it performs a safe reset (pump off and state idle).
5. Water filling is allowed only between `00:00` (inclusive) and `03:00` (exclusive), and is automatically stopped outside this window.

### MixTank Controller Technical Description

`MixTankFertilizerController.js` is implemented as a small finite-state controller with explicit persistence and restart recovery. The script is designed to tolerate Shelly script restarts, temporary lack of system time, and RPC burst limits during startup.

#### Physical I/O contract

1. `input:0` is the low-level sensor.
2. `input:1` is the high-level sensor.
3. `switch:0` drives the water refill valve.
4. `switch:1` drives the fertilizer dosing pump.

Expected process sequence:

1. Tank reaches low level and `input:0` becomes `true`.
2. Controller opens the water valve and enters `FILLING_WATER`.
3. Tank reaches high level and `input:1` becomes `true`.
4. Controller closes the water valve, starts the fertilizer pump, and enters `DOSING_FERTILIZER`.
5. After `FERTILIZER_TIMEOUT_MS`, the controller stops the pump and returns to `IDLE`.

#### State model

The controller uses three integer-backed states:

| State | Value | Meaning |
|-------|-------|---------|
| `STATE_IDLE` | `0` | No active fill or dosing operation. |
| `STATE_FILLING_WATER` | `1` | Water valve should be open and pump should be off. |
| `STATE_DOSING_FERTILIZER` | `2` | Water valve should be closed and fertilizer pump should be on until timeout. |

Every state transition goes through `transitionTo(...)`, which logs the transition and writes the current state to KVS. This keeps the persisted state aligned with the last accepted control decision rather than only the last sensor event.

#### Event-driven runtime behavior

The main runtime loop is based on `Shelly.addStatusHandler(...)`:

1. The handler ignores all events until startup recovery has completed.
2. When `input:0` changes to `true`, `startWaterFillCycle()` is called.
3. When `input:1` changes to `true`, `startDosingCycle()` is called.
4. `false` transitions are only logged; they do not directly change state.

This means the controller is edge-triggered for normal operation, but recovery logic supplements this with level-based bootstrap checks after restart.

#### Water fill logic

`startWaterFillCycle()` enforces two hard preconditions before opening the valve:

1. Current state must be `STATE_IDLE`.
2. Current local time must be inside the allowed refill window `00:00 <= time < 03:00`.

If both conditions are met, the script sends `Switch.set` for the water valve and transitions to `STATE_FILLING_WATER` in the RPC success callback. The transition is therefore coupled to confirmed command submission rather than assumed immediately.

#### Fertilizer dosing logic

`startDosingCycle()` only accepts a trigger while in `STATE_FILLING_WATER`.

The function performs these operations:

1. Sends a command to close the water valve.
2. Sends a command to start the fertilizer pump.
3. Computes `dosingEndsAtUnix` from current unix time plus the configured dosing duration.
4. Transitions to `STATE_DOSING_FERTILIZER` when pump activation succeeds.
5. Schedules a one-shot timer that calls `stopDosingAndReset()` after `FERTILIZER_TIMEOUT_MS`.
6. Publishes an ntfy notification indicating fertilizer was added.

`stopDosingAndReset()` clears the dosing timer, resets `dosingEndsAtUnix`, turns the pump off, and returns the controller to `STATE_IDLE`.

#### Time handling and fill window enforcement

The controller uses two different system-time signals:

1. `sys.time` is parsed as `HH:MM` and used for refill-window decisions.
2. `sys.unixtime` is used for calculating and recovering remaining dosing duration.

If local time cannot be parsed, the refill window check fails closed. In other words, automatic water fill will not start unless the script can prove that current time is inside the allowed window.

In addition to the event-driven start gate, a repeating timer runs every `WINDOW_ENFORCE_INTERVAL_MS`. If the controller is still in `STATE_FILLING_WATER` after the allowed window closes, it explicitly shuts the valve, ensures the pump is off, and returns to `STATE_IDLE`.

#### Persistence model

The persisted KVS payload contains:

```json
{
  "state": 1,
  "dosingEndsAtUnix": 1775599999,
  "savedAtUnix": 1775599900
}
```

Only `state` and `dosingEndsAtUnix` are required for recovery. `savedAtUnix` is retained as an audit/debug field showing when persistence last ran.

Persistence is updated on:

1. Every accepted state transition.
2. Startup normalization paths such as restoring filling, restoring dosing, or forcing idle after invalid recovery data.

#### Restart recovery sequence

Startup uses a multi-stage recovery flow:

1. `restoreStateFromKvs(...)` reads the last persisted payload.
2. If no saved state exists, the controller initializes to `IDLE` and persists a fresh baseline.
3. `applyRecoveredState()` then reasserts the expected outputs for the recovered state.

Recovery behavior by state:

1. `STATE_FILLING_WATER`
  The controller verifies the current time window. If the refill window is still valid, it reopens the water valve and forces the pump off. If the window is no longer valid, it turns both outputs off and resets to `IDLE`.
2. `STATE_DOSING_FERTILIZER`
  The controller requires both valid unix time and a persisted `dosingEndsAtUnix`. It computes the remaining dosing time. If time is invalid or the dosing end time has already passed, it performs a safe reset to `IDLE`. Otherwise it turns the valve off, resumes the pump, reschedules the remaining timer, and keeps state synchronized in KVS.
3. `STATE_IDLE`
  The controller forces both outputs off and persists the normalized idle state.

#### Startup bootstrap for missed edge events

Shelly status handlers are event-driven, so a script restart can miss an already-active sensor edge. To prevent the controller from remaining idle after restart when the tank is still low, the script runs `bootstrapFromCurrentInputs()` shortly after startup recovery.

The bootstrap logic:

1. Reads the current boolean state of both sensor inputs using `Shelly.getComponentStatus("input:X")`.
2. Logs the observed input levels and current controller state.
3. If the controller is `IDLE` and the low-level sensor is already `true`, it logs a startup-bootstrap message, sends an ntfy notification, and calls `startWaterFillCycle()`.
4. If the controller is `STATE_FILLING_WATER` and the high-level sensor is already `true`, it immediately advances into fertilizer dosing.

The bootstrap call is intentionally delayed by `500 ms` after startup recovery so that output reassertion and KVS recovery RPCs have time to complete first.

#### RPC retry and overload handling

Shelly can throw `Too many calls in progress` when several RPCs are issued in a tight burst, especially during startup recovery. The script mitigates this inside `callRpc(...)`.

Current behavior:

1. All RPCs are funneled through a single wrapper.
2. If `Shelly.call(...)` throws synchronously, the wrapper logs `[RPC RETRY]` and retries after `200 ms`.
3. The retry loop currently allows up to `8` retry attempts.
4. If all retries fail, the wrapper logs `[RPC THROW]` and reports a synthetic error to the optional error callback.

This keeps startup recovery from crashing the script when several `Switch.set`, `KVS.Get`, `KVS.Set`, or `HTTP.POST` operations overlap briefly.

#### Failure and safety characteristics

The controller is conservative by design:

1. If current time is unknown, refill start is denied.
2. If persisted dosing timing is invalid on restart, dosing does not resume blindly.
3. If the refill window closes while filling, the valve is shut and state is reset.
4. Output states are explicitly reasserted on recovery instead of trusting previous relay state.
5. Duplicate or out-of-order triggers are ignored when they do not match the expected current state.

These decisions bias the system toward stopping automation rather than continuing with uncertain process state.

#### Home Assistant virtual-state entity

The controller exposes one virtual text component with the active process state so Home Assistant can consume it as a single status signal.

Implementation details:

1. The script uses virtual component `text:200` (`ACTIVE_STATE_VC_KEY`).
2. If the component is missing, the script creates it automatically with `Virtual.Add` and name `MixTank Active State`.
3. On startup recovery completion and on every state transition, the script writes the state string to the virtual component.

Published values:

1. `IDLE`
2. `FILLING_WATER`
3. `DOSING_FERTILIZER`

Home Assistant usage notes:

1. Add the Shelly device through the Shelly integration as usual.
2. Locate the virtual text entity corresponding to component key `text:200`.
3. Use that entity value in automations, template sensors, or dashboard badges for process-state visibility.
4. If you changed `ACTIVE_STATE_VC_ID`, update Home Assistant references to the new virtual component key.

### Change Log

- 2026-04-15: Added complete README structure (Overview, configuration, runtime behavior, notes, setup).
- 2026-04-15: Reworked wording into a more technical, implementation-oriented style.
- 2026-04-15: Added concise project summary at the top for quick context.
- 2026-05-04: Added `MixTankFertilizerController.js` to project overview, file list, and setup section.
- 2026-05-04: Added reboot-safe KVS persistence and startup recovery documentation for `MixTankFertilizerController.js`.
- 2026-05-10: Expanded README with detailed technical documentation for `MixTankFertilizerController.js`, including state machine, startup bootstrap, and RPC overload retry behavior.
- 2026-05-10: Documented Home Assistant virtual-state exposure via virtual component `text:200` and added MixTank VC configuration details.
