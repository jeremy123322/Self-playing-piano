# Embedded-system testing

The native embedded harness exercises the same C++ cores that are compiled into
the ESP32 and Nano firmware. It does not reproduce those cores in JavaScript and
does not use MQTT, Postgres or a simulated cloud piano.

## Tested path

The in-memory test path is:

```text
validated SPP artifact
  -> ESP32 playback state machine and look-ahead scheduler
  -> production 12-byte protocol client
  -> framed, pipelined SPI link
  -> Nano protocol controller and bounded event queue
  -> production logical-key mapping and solenoid policy
  -> recorded PCA board/channel/PWM operations
```

Time is deterministic. The link and output bus can lose responses, corrupt
frames, fill queues, stop acknowledging commands and fail output writes.

The suite covers:

- artifact headers, sizes, records, duration, ordering, same-key overlap and
  maximum polyphony;
- CRC validation, byte layouts, acknowledgements, duplicate sequences and
  retry behavior;
- queue wraparound, queue-full backpressure and dense playback without event
  loss;
- all legacy key mappings, PCA board/channel reversal, velocity preservation
  and the intentionally unmapped final key;
- six-board initialization, output-enable sequencing, complete all-off attempts
  and I2C/PWM failure shutdown policy;
- play, live position feedback, pause, resume of sustained notes, restart, stop,
  completion, session/revision guards and artifact failure;
- emergency recovery across a stale session, safe controller restart and failed
  recovery through the Nano watchdog;
- durable status outbox ordering, wraparound and bounded overflow behavior;
- startup without Nano hardware, Nano communication watchdog behavior, error
  shutdown without heartbeats and millisecond-counter rollover.

Run it with:

```sh
pio test --project-dir firmware/embedded-tests --environment native
```

The smaller wire-format suite is separate:

```sh
pio test --project-dir firmware/shared --environment native
```

Both firmware targets are compiled in CI after these tests.

## ESP32 loopback build

The loopback build runs the real Wi-Fi, MQTT, HTTPS download, artifact validation,
playback task and reported-state code on an ESP32. Only the electrical SPI/PCA
edge is replaced by the production Nano controller running in memory:

```sh
pio run --project-dir firmware/esp32 --environment esp32-loopback
```

It uses the configured piano identity, so the normal ESP32 must not be online at
the same time. Its reported firmware version is `2.4.1-loopback`, and it prints a
loopback warning on Serial. This build is only for an unpowered test board; it
never drives solenoid outputs.

## What still needs hardware

Native tests cannot prove electrical properties. Before enabling solenoid power,
the acceptance run must still verify:

- signal levels, SPI mode and timing across the physical ESP32/Nano wiring;
- real PCA9685 discovery at addresses `0x40` through `0x45`;
- the output-enable pin and the six boards' `ALL_LED_OFF` behavior;
- actual I2C NACK/timeout behavior with a disconnected or failing board;
- solenoid polarity, wiring order, current limits and mechanical timing.

The first physical run therefore uses the real ESP32 and Nano with solenoid
power disabled. See [hardware-acceptance.md](hardware-acceptance.md).
