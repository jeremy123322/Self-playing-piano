# Reliability model

The device runtime has two responsibilities:

- The ESP32 playback task exclusively owns the playback state machine, SPI transport and Nano heartbeat.
- The ESP32 network side exclusively owns Wi-Fi, BLE provisioning, time synchronization, MQTT and HTTP.
- BLE provisioning is a boot mode. A safe Wi-Fi timeout or admin request is persisted in NVS before a software restart, allowing Bluetooth memory to be released during normal operation without preventing future provisioning.

They exchange bounded typed messages. MQTT callbacks never mutate playback state, and slow HTTP/MQTT operations cannot delay SPI supervision. The Nano executes only acknowledged, CRC-protected protocol-v2 frames and clears all outputs if the heartbeat stops.

Cloud command dispatch is deliberately safety-biased:

1. Neon atomically reserves the piano, session and revision.
2. A later request is rejected while that revision is still being published, so independent Vercel invocations cannot deliver revisions out of order.
3. Vercel publishes Play and transport commands without retention; shutdown commands remain retained so a reconnect still converges to all-off.
4. Vercel waits for the broker's QoS 1 acknowledgement.
5. A connection failure is known not to have published and may release a newly reserved session.
6. A publish timeout is ambiguous, so the session remains locked until its device acknowledgement or an explicit Stop supersedes it.

There is no offline Play queue and no background dispatcher. This avoids surprise playback after an outage and keeps the deployed architecture limited to Vercel, Neon, object storage and EMQX.

The ESP32 deliberately permits only one active TLS connection. Its persistent
MQTT session bridges the short periods where that connection is handed to
HTTPS, while command expiry prevents those broker-queued messages from becoming
an offline playback queue. Durable reports are posted one at a time; the device
reconnects MQTT and services a control window between reports instead of
draining the entire HTTP outbox in one command blackout.

The ESP32 is authoritative for live runtime state. Browsers use its retained MQTT report for both the global status indicator and the diagnostics current-state card. Neon is the durable arbitration and history mirror, not a second live authority.

Significant device transitions, command acknowledgements and session outcomes enter a bounded in-memory outbox. The ESP32 posts them to the device-status endpoint in order, checks the HTTP response and retries failures with capped exponential backoff. If the outbox approaches capacity, MQTT command intake pauses until delivery recovers; transitions are not silently replaced by newer state. The once-per-minute durable heartbeat uses the same delivery path.

After a reboot, an idle device may recover an orphaned cloud session only when its NVS-persisted handled revision covers every command issued by the server. A matching applied Stop finalizes the session as stopped; any other missing terminal outcome is recorded as a failure before the piano is unlocked.

Admin diagnostics provide two session-independent recovery commands. Emergency recovery clears the scheduler and returns to idle only after the Nano acknowledges all-off. Safe controller restart performs the same shutdown, delivers its acknowledgement through the durable outbox, and only then restarts the ESP32. Neither action can clear or bypass a failed all-off; the Nano watchdog remains the final shutdown path.

Artifacts are immutable. Reprocessing creates a new current artifact while existing sessions retain the exact artifact they used. Archiving removes a song from the library without destroying referenced history or objects.

Every device report identifies the compiled profile id and version. Vercel records mismatches but refuses new Play commands, and the ESP32 independently checks command metadata plus the artifact header before accepting playback. Artifact v1/profile v1 remains an explicit read-only compatibility case; artifact v2 must match the current compiled profile version.

Artifact v2 stores musical strike time and actuator lead separately. The browser renders the strike time while the ESP32 schedules note-on at `strike - activationLead`; note-off remains at the musical end. Polyphony and same-key reset validation operate on these expanded electrical intervals. Firmware continues to accept v1 artifacts with zero actuator lead during a staged library migration.

## Contract-change deployment order

Apply database migrations before deploying Vercel. The migrations are additive
and remain readable by the previous web release. The new web release accepts
reports from older firmware but quarantines their unknown profile version and
refuses Play. Flash ESP32 and Nano release 2.4.1 together; the next durable
report clears the quarantine after both profile id and version match. Shutdown
commands remain available while quarantined.
