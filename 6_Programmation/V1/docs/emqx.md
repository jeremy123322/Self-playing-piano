# EMQX configuration

Use TLS MQTT for the ESP32 and Vercel publisher, plus secure WebSocket MQTT for browsers. Disable anonymous access.

Create three identities:

| Identity | MQTT client ID | Subscribe | Publish |
| --- | --- | --- | --- |
| `vercel-publisher` | unique per request | none | `pianos/+/v1/desired` |
| `piano-device` | the exact piano UUID | `pianos/${clientid}/v1/desired` | `pianos/${clientid}/v1/reported` |
| `browser-readonly` | unique per browser | `pianos/+/v1/reported` | none |

Explicitly deny every other topic/action after the allow rules. The browser password is intentionally not treated as a secret; its account is safe only because the broker ACL gives it no publishing permission. If public status is undesirable, replace it with short-lived broker credentials later without changing the MQTT payloads.

For the device rules, allow only `Subscribe` on `desired` and only `Publish` on `reported`. EMQX replaces `${clientid}` with the full MQTT client ID, so the firmware and simulator both connect with the bare piano UUID.

The shared controller password protects the Vercel command API; it is not an MQTT credential. A browser must never receive `vercel-publisher` or `piano-device` credentials. Even someone who extracts the browser MQTT password can only read reported status because EMQX denies publishing for that identity.

Recommended broker settings:

- MQTT 3.1.1 or 5 over TLS on port 8883.
- MQTT over secure WebSocket at `/mqtt`.
- Retained messages and QoS 1 enabled.
- Persistent retained Last Will on the reported topic.
- Client ID uniqueness enforced; use one device identity per piano.
- Certificate chain trusted by the ESP32 firmware.

The Vercel application opens a short MQTT connection only while dispatching a command. The ESP32 holds its connection open while powered. A desired command is retained and revisioned; the device persists handled and applied revisions and rejects expired or duplicate commands after reconnecting.

Switching brokers requires recreating these identities/ACLs and changing environment/device connection values. Application code and topics remain unchanged.
