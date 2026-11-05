# Hardware acceptance checklist

Keep solenoid power disabled until both firmware builds are flashed and all six PCA boards are detected.

1. Flash Nano and ESP32 together.
2. Confirm Nano serial output says `Nano ready`; a missing address `0x40`–`0x45` must keep outputs disabled.
3. Provision Wi-Fi over BLE, reboot and confirm it reconnects without provisioning.
4. Leave Wi-Fi unavailable for 60 seconds and confirm the ESP32 software-restarts once, then advertises `PROV_PIANO_…` over BLE immediately.
5. After at least one minute of normal uptime, interrupt Wi-Fi briefly. Confirm reconnection is attempted for a full 60 seconds before a provisioning restart is scheduled.
6. Upload and play `piano_88_notes_1s_each.mid`; record the known high-note wiring mismatch and confirm the final unmapped key is reported by upload processing.
7. Play a dense song and verify at most ten simultaneous solenoids without queue overflow.
8. Confirm the first note arrives after the five-second falling-note lead-in, then calibrate the profile's 20 ms activation lead with short notes while solenoid temperature and current are monitored.
9. Pause after several seconds and resume. Confirm the resumed position is correct rather than jumping ahead.
10. Pause, restart and stop repeatedly; all active outputs must turn off immediately during pause/stop.
11. Add five seconds of artificial latency to the durable-status endpoint. Playback and Nano heartbeats must continue without interruption.
12. Disconnect the browser and MQTT while playing. Playback must continue locally and the retained state must restore the UI after reconnect.
13. Disconnect Wi-Fi while playing. Playback must finish locally without a provisioning restart; once idle, durable status must catch up after reconnecting or the delayed provisioning restart may proceed.
14. Interrupt SPI while a note is active so its note-off and the ESP32's first all-off attempt fail, then restore SPI before the two-second watchdog deadline. The ESP32 must retry all-off without sending heartbeats; the output must turn off by the successful retry or watchdog timeout.
15. Interrupt SPI communication for more than two seconds. The Nano watchdog must clear its queue and all 96 outputs; the ESP32 must report an error instead of continuing a false playing state.
16. With solenoid power disabled, force an I2C NACK during note-on and note-off writes. The Nano must disable output-enable, stop its clock, report unavailable hardware and require reinitialization.
17. Make the final song all-off acknowledgement fail. The ESP32 must report a failed session in `error`, never `completed` or `idle`.
18. Reset the Nano during playback. The ESP32 must detect the stopped Nano clock, enter error and leave every output off.
19. Test malformed/truncated artifact, wrong SHA-256 and ESP32 reset. Every failure must leave all outputs off.
20. Replace the configured CA with an invalid certificate and verify MQTT/HTTPS fail closed; restore the correct bundle before hardware use.
