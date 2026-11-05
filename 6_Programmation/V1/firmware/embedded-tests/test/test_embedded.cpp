#include <unity.h>

#include <algorithm>
#include <initializer_list>
#include <limits>
#include <memory>
#include <string.h>
#include <vector>

#include "artifact.h"
#include "command_expiry.h"
#include "durable_status_queue.h"
#include "event_queue.h"
#include "nano_controller.h"
#include "note_mapping.h"
#include "playback_controller.h"
#include "solenoid_driver.h"
#include "spp_release.h"
#include "spi_transport.h"

void setUp() {}
void tearDown() {}

namespace {

class FakeClock final : public spp::PlaybackClock {
 public:
  uint32_t nowMs() const override { return nowMs_; }
  void delayMs(uint32_t durationMs) override { nowMs_ += durationMs; }
  void advance(uint32_t durationMs) { nowMs_ += durationMs; }
  void set(uint32_t nowMs) { nowMs_ = nowMs; }

 private:
  uint32_t nowMs_ = 0;
};

struct OutputAction {
  uint32_t atMs;
  uint8_t keyIndex;
  uint8_t output;
  uint8_t velocity;
  bool on;
};

class RecordingOutput final : public spp::KeyOutput {
 public:
  explicit RecordingOutput(FakeClock& clock) : clock_(clock) {}

  bool allOff() override {
    ++allOffCalls;
    for (uint8_t key = 0; key < active.size(); ++key) {
      if (!active[key]) continue;
      actions.push_back(OutputAction{clock_.nowMs(), key,
                                     spp::outputForKey(key), 0, false});
    }
    std::fill(active.begin(), active.end(), false);
    if (allOffFailures == 0) return ready_;
    --allOffFailures;
    ready_ = false;
    return false;
  }

  bool setKey(uint8_t keyIndex, bool on, uint8_t velocity) override {
    if (!ready_ || failNextSet) {
      failNextSet = false;
      ready_ = false;
      return false;
    }
    const uint8_t output = spp::outputForKey(keyIndex);
    if (output == spp::kUnmappedOutput) return false;
    active[keyIndex] = on;
    actions.push_back(OutputAction{clock_.nowMs(), keyIndex, output, velocity,
                                   on});
    return true;
  }

  bool ready() const override { return ready_; }
  void setReady(bool ready) { ready_ = ready; }
  bool anyActive() const {
    return std::find(active.begin(), active.end(), true) != active.end();
  }

  FakeClock& clock_;
  std::vector<bool> active = std::vector<bool>(88, false);
  std::vector<OutputAction> actions;
  uint32_t allOffCalls = 0;
  uint8_t allOffFailures = 0;
  bool failNextSet = false;

 private:
  bool ready_ = true;
};

struct PwmWrite {
  uint8_t board;
  uint8_t channel;
  uint16_t pwm;
};

class FakePcaBus final : public spp::PcaBus {
 public:
  void begin() override { began = true; }
  bool addressPresent(uint8_t address) override {
    return address >= 0x40 && address <= 0x45 &&
           addresses[address - 0x40];
  }
  bool beginBoard(uint8_t boardIndex) override {
    begunBoards.push_back(boardIndex);
    return boardIndex != failedBeginBoard;
  }
  bool setPwm(uint8_t boardIndex, uint8_t channel,
              uint16_t pwm) override {
    writes.push_back({boardIndex, channel, pwm});
    return !failWrite;
  }
  bool clearBoard(uint8_t boardIndex) override {
    clearedBoards.push_back(boardIndex);
    return boardIndex != failedClearBoard;
  }
  void setOutputsEnabled(bool enabled) override {
    outputsEnabled = enabled;
    enableHistory.push_back(enabled);
  }

  bool addresses[6] = {true, true, true, true, true, true};
  std::vector<uint8_t> begunBoards;
  std::vector<uint8_t> clearedBoards;
  std::vector<PwmWrite> writes;
  std::vector<bool> enableHistory;
  uint8_t failedBeginBoard = 0xFF;
  uint8_t failedClearBoard = 0xFF;
  bool began = false;
  bool failWrite = false;
  bool outputsEnabled = false;
};

class LoopbackSpiLink final : public spp::SpiFrameLink {
 public:
  LoopbackSpiLink(spp::NanoController& nano, FakeClock& clock)
      : nano_(nano), clock_(clock) {}

  void transfer(const spp::Frame& outgoing, spp::Frame& incoming) override {
    ++transferCount;
    incoming = nano_.response();
    if (hiddenResponses > 0) {
      --hiddenResponses;
      incoming = spp::Frame{};
    }

    spp::Frame delivered = outgoing;
    const auto type = static_cast<spp::MessageType>(delivered.bytes[2]);
    if (blocked_[delivered.bytes[2]]) return;
    if (corruptNextCommand && type != spp::MessageType::kStatus) {
      corruptNextCommand = false;
      delivered.bytes[5] ^= 0x01;
    }
    ++deliveredByType[delivered.bytes[2]];
    nano_.processFrame(delivered, clock_.nowMs());
  }

  void block(spp::MessageType type, bool blocked = true) {
    blocked_[static_cast<uint8_t>(type)] = blocked;
  }

  spp::NanoController& nano_;
  FakeClock& clock_;
  uint32_t transferCount = 0;
  uint16_t hiddenResponses = 0;
  bool corruptNextCommand = false;
  uint32_t deliveredByType[256]{};

 private:
  bool blocked_[256]{};
};

void write32(uint8_t* destination, uint32_t value) {
  spp::writeUint32(destination, value);
}

std::unique_ptr<uint8_t[]> artifactBytes(
    const std::vector<spp::ArtifactNote>& notes, size_t& size,
    uint32_t durationOverride = UINT32_MAX) {
  size = 16 + notes.size() * 12;
  std::unique_ptr<uint8_t[]> data(new uint8_t[size]{});
  memcpy(data.get(), "SPP1", 4);
  data[4] = 2;
  data[5] = 2;
  data[6] = 12;
  data[7] = 0;
  write32(data.get() + 8, static_cast<uint32_t>(notes.size()));
  uint32_t durationMs = 0;
  for (size_t index = 0; index < notes.size(); ++index) {
    const spp::ArtifactNote& note = notes[index];
    const size_t offset = 16 + index * 12;
    write32(data.get() + offset, note.startMs);
    write32(data.get() + offset + 4, note.durationMs);
    data[offset + 8] = note.keyIndex;
    data[offset + 9] = note.velocity;
    data[offset + 10] = note.flags;
    data[offset + 11] = note.activationLeadMs;
    durationMs = std::max(durationMs, note.startMs + note.durationMs);
  }
  write32(data.get() + 12,
          durationOverride == UINT32_MAX ? durationMs : durationOverride);
  return data;
}

spp::Artifact makeArtifact(const std::vector<spp::ArtifactNote>& notes) {
  size_t size = 0;
  std::unique_ptr<uint8_t[]> bytes = artifactBytes(notes, size);
  spp::Artifact artifact;
  spp::ArtifactError error = spp::ArtifactError::kNone;
  if (!artifact.adopt(std::move(bytes), size, error)) return spp::Artifact{};
  return artifact;
}

void copyId(char* destination, size_t size, const char* value) {
  strncpy(destination, value, size - 1);
  destination[size - 1] = '\0';
}

spp::DesiredCommand command(spp::CommandType type, uint32_t revision = 1) {
  spp::DesiredCommand result{};
  result.type = type;
  result.revision = revision;
  copyId(result.commandId, sizeof(result.commandId),
         "11111111-1111-4111-8111-111111111111");
  copyId(result.sessionId, sizeof(result.sessionId),
         "22222222-2222-4222-8222-222222222222");
  copyId(result.songId, sizeof(result.songId),
         "33333333-3333-4333-8333-333333333333");
  copyId(result.profileId, sizeof(result.profileId), spp::kProfileId);
  result.profileVersion = spp::kProfileVersion;
  result.artifactVersion = 2;
  return result;
}

class EmbeddedHarness {
 public:
  EmbeddedHarness()
      : output(clock),
        nano(output),
        link(nano, clock),
        transport(link, clock),
        playback(transport, clock) {
    nano.begin();
    playback.begin(0, 0);
  }

  void start(const std::vector<spp::ArtifactNote>& notes) {
    spp::DesiredCommand play = command(spp::CommandType::kPlay);
    TEST_ASSERT_EQUAL_UINT8(
        static_cast<uint8_t>(spp::CommandHandling::kDownloadArtifact),
        static_cast<uint8_t>(playback.handle(play)));
    spp::Artifact artifact = makeArtifact(notes);
    TEST_ASSERT_EQUAL_UINT32(notes.size(), artifact.noteCount());
    playback.artifactReady(play, std::move(artifact));
    TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kPlaying),
                            static_cast<uint8_t>(playback.snapshot().state));
  }

  void advance(uint32_t durationMs) {
    const uint32_t startedAt = clock.nowMs();
    do {
      clock.advance(1);
      playback.tick();
      nano.tick(clock.nowMs());
    } while (clock.nowMs() - startedAt < durationMs);
  }

  FakeClock clock;
  RecordingOutput output;
  spp::NanoController nano;
  LoopbackSpiLink link;
  spp::SpiTransport transport;
  spp::PlaybackController playback;
};

void test_artifact_accepts_valid_records() {
  spp::Artifact artifact = makeArtifact({
      {110, 100, 2, 90, 0, 20},
      {120, 50, 3, 120, 0, 20},
  });
  TEST_ASSERT_EQUAL_UINT32(2, artifact.noteCount());
  TEST_ASSERT_EQUAL_UINT32(210, artifact.durationMs());
  spp::ArtifactNote note{};
  TEST_ASSERT_TRUE(artifact.noteAt(1, note));
  TEST_ASSERT_EQUAL_UINT8(3, note.keyIndex);
  TEST_ASSERT_EQUAL_UINT8(120, note.velocity);
  TEST_ASSERT_EQUAL_UINT8(20, note.activationLeadMs);
}

void test_artifact_accepts_legacy_v1_without_activation_lead() {
  size_t size = 0;
  auto bytes = artifactBytes({{100, 50, 2, 90, 0, 0}}, size);
  bytes[4] = 1;
  bytes[5] = 1;
  spp::Artifact artifact;
  spp::ArtifactError error = spp::ArtifactError::kNone;
  TEST_ASSERT_TRUE(artifact.adopt(std::move(bytes), size, error));
  spp::ArtifactNote note{};
  TEST_ASSERT_TRUE(artifact.noteAt(0, note));
  TEST_ASSERT_EQUAL_UINT8(0, note.activationLeadMs);
}

void test_artifact_rejects_incompatible_profile_version() {
  size_t size = 0;
  auto bytes = artifactBytes({{100, 50, 2, 90, 0, 20}}, size);
  bytes[5] = 3;
  spp::Artifact artifact;
  spp::ArtifactError error = spp::ArtifactError::kNone;
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kIncompatibleProfile),
      static_cast<uint8_t>(error));
}

void test_command_expiry_uses_epoch_seconds_without_date_parsing() {
  TEST_ASSERT_FALSE(spp::commandExpired(101, 100, true));
  TEST_ASSERT_TRUE(spp::commandExpired(100, 100, true));
  TEST_ASSERT_TRUE(spp::commandExpired(0, 100, true));
  TEST_ASSERT_TRUE(spp::commandExpired(101, 100, false));
}

void test_durable_status_queue_preserves_order_and_rejects_overflow() {
  spp::DurableStatusQueue<3> queue;
  spp::PlaybackSnapshot first{};
  spp::PlaybackSnapshot second{};
  spp::PlaybackSnapshot third{};
  spp::PlaybackSnapshot fourth{};
  first.lastHandledRevision = 1;
  second.lastHandledRevision = 2;
  third.lastHandledRevision = 3;
  fourth.lastHandledRevision = 4;

  TEST_ASSERT_TRUE(queue.push(first));
  TEST_ASSERT_TRUE(queue.push(second));
  TEST_ASSERT_TRUE(queue.push(third));
  TEST_ASSERT_FALSE(queue.push(fourth));
  TEST_ASSERT_EQUAL_UINT32(1, queue.front()->lastHandledRevision);
  TEST_ASSERT_TRUE(queue.pop());
  TEST_ASSERT_EQUAL_UINT32(2, queue.front()->lastHandledRevision);
  TEST_ASSERT_TRUE(queue.push(fourth));
  TEST_ASSERT_TRUE(queue.pop());
  TEST_ASSERT_EQUAL_UINT32(3, queue.front()->lastHandledRevision);
  TEST_ASSERT_TRUE(queue.pop());
  TEST_ASSERT_EQUAL_UINT32(4, queue.front()->lastHandledRevision);
  TEST_ASSERT_TRUE(queue.pop());
  TEST_ASSERT_TRUE(queue.empty());
}

void test_artifact_rejects_bad_header_and_count() {
  size_t size = 0;
  auto bytes = artifactBytes({{0, 10, 0, 1, 0}}, size);
  bytes[0] = 'X';
  spp::Artifact artifact;
  spp::ArtifactError error = spp::ArtifactError::kNone;
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kUnsupportedFormat),
      static_cast<uint8_t>(error));

  bytes = artifactBytes({{0, 10, 0, 1, 0}}, size);
  write32(bytes.get() + 8, UINT32_MAX);
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kInvalidRecordCount),
      static_cast<uint8_t>(error));
}

void test_artifact_rejects_malformed_note_data() {
  size_t size = 0;
  spp::Artifact artifact;
  spp::ArtifactError error = spp::ArtifactError::kNone;

  auto bytes = artifactBytes({{0, 0, 0, 1, 0}}, size);
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kInvalidRecord),
      static_cast<uint8_t>(error));

  bytes = artifactBytes({{20, 10, 0, 1, 0}, {10, 5, 1, 1, 0}}, size);
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kUnsortedRecords),
      static_cast<uint8_t>(error));

  bytes = artifactBytes({{0, 20, 0, 1, 0}, {10, 20, 0, 2, 0}}, size);
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kInvalidRecord),
      static_cast<uint8_t>(error));

  bytes = artifactBytes({{0, 20, 0, 1, 0}, {119, 20, 0, 2, 0}}, size);
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kInvalidRecord),
      static_cast<uint8_t>(error));

  bytes = artifactBytes({{10, 20, 1, 1, 0, 20}}, size);
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kInvalidRecord),
      static_cast<uint8_t>(error));

  bytes = artifactBytes({{100, 20, 1, 1, 0, 0},
                         {110, 20, 2, 1, 0, 20}}, size);
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kUnsortedRecords),
      static_cast<uint8_t>(error));
}

void test_artifact_rejects_more_than_ten_simultaneous_notes() {
  std::vector<spp::ArtifactNote> notes;
  for (uint8_t key = 0; key < 11; ++key) {
    notes.push_back({0, 100, key, 100, 0});
  }
  size_t size = 0;
  auto bytes = artifactBytes(notes, size);
  spp::Artifact artifact;
  spp::ArtifactError error = spp::ArtifactError::kNone;
  TEST_ASSERT_FALSE(artifact.adopt(std::move(bytes), size, error));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ArtifactError::kPolyphonyExceeded),
      static_cast<uint8_t>(error));
}

void test_event_queue_wraps_without_losing_order() {
  spp::EventQueue<3> queue;
  TEST_ASSERT_TRUE(queue.push({1, 1, 1, true}));
  TEST_ASSERT_TRUE(queue.push({2, 2, 2, true}));
  TEST_ASSERT_TRUE(queue.push({3, 3, 3, true}));
  TEST_ASSERT_FALSE(queue.push({4, 4, 4, true}));
  TEST_ASSERT_EQUAL_UINT8(1, queue.front()->keyIndex);
  queue.pop();
  TEST_ASSERT_TRUE(queue.push({4, 4, 4, true}));
  TEST_ASSERT_EQUAL_UINT8(2, queue.front()->keyIndex);
  queue.pop();
  TEST_ASSERT_EQUAL_UINT8(3, queue.front()->keyIndex);
  queue.pop();
  TEST_ASSERT_EQUAL_UINT8(4, queue.front()->keyIndex);
}

void test_legacy_mapping_covers_every_logical_key() {
  for (uint8_t key = 0; key <= 72; ++key) {
    TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(key + 8),
                            spp::outputForKey(key));
  }
  for (uint8_t key = 73; key <= 86; ++key) {
    TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(key + 9),
                            spp::outputForKey(key));
  }
  TEST_ASSERT_EQUAL_UINT8(spp::kUnmappedOutput, spp::outputForKey(87));
  TEST_ASSERT_EQUAL_UINT8(spp::kUnmappedOutput, spp::outputForKey(88));
}

void test_solenoid_initialization_requires_every_board_and_stays_disabled() {
  FakePcaBus bus;
  bus.addresses[3] = false;
  spp::SolenoidDriver driver(bus);
  TEST_ASSERT_FALSE(driver.begin());
  TEST_ASSERT_TRUE(bus.began);
  TEST_ASSERT_FALSE(driver.ready());
  TEST_ASSERT_FALSE(bus.outputsEnabled);
  TEST_ASSERT_EQUAL_UINT32(0, bus.begunBoards.size());
}

void test_solenoid_initialization_clears_all_six_boards_before_enable() {
  FakePcaBus bus;
  spp::SolenoidDriver driver(bus);
  TEST_ASSERT_TRUE(driver.begin());
  TEST_ASSERT_TRUE(driver.ready());
  TEST_ASSERT_TRUE(bus.outputsEnabled);
  TEST_ASSERT_EQUAL_UINT32(6, bus.begunBoards.size());
  TEST_ASSERT_EQUAL_UINT32(6, bus.clearedBoards.size());
  for (uint8_t board = 0; board < 6; ++board) {
    TEST_ASSERT_EQUAL_UINT8(board, bus.begunBoards[board]);
    TEST_ASSERT_EQUAL_UINT8(board, bus.clearedBoards[board]);
  }
  TEST_ASSERT_FALSE(bus.enableHistory.front());
  TEST_ASSERT_TRUE(bus.enableHistory.back());
}

void test_solenoid_mapping_reversal_velocity_and_note_off() {
  FakePcaBus bus;
  spp::SolenoidDriver driver(bus);
  TEST_ASSERT_TRUE(driver.begin());
  TEST_ASSERT_TRUE(driver.setKey(0, true, 1));
  TEST_ASSERT_TRUE(driver.setKey(72, true, 200));
  TEST_ASSERT_TRUE(driver.setKey(73, true, 127));
  TEST_ASSERT_TRUE(driver.setKey(86, false, 55));
  TEST_ASSERT_FALSE(driver.setKey(87, true, 100));
  TEST_ASSERT_EQUAL_UINT32(4, bus.writes.size());
  TEST_ASSERT_EQUAL_UINT8(0, bus.writes[0].board);
  TEST_ASSERT_EQUAL_UINT8(7, bus.writes[0].channel);
  TEST_ASSERT_EQUAL_UINT16(4095, bus.writes[0].pwm);
  TEST_ASSERT_EQUAL_UINT8(5, bus.writes[1].board);
  TEST_ASSERT_EQUAL_UINT8(15, bus.writes[1].channel);
  TEST_ASSERT_EQUAL_UINT16(4095, bus.writes[1].pwm);
  TEST_ASSERT_EQUAL_UINT8(5, bus.writes[2].board);
  TEST_ASSERT_EQUAL_UINT8(13, bus.writes[2].channel);
  TEST_ASSERT_EQUAL_UINT8(5, bus.writes[3].board);
  TEST_ASSERT_EQUAL_UINT8(0, bus.writes[3].channel);
  TEST_ASSERT_EQUAL_UINT16(0, bus.writes[3].pwm);
}

void test_solenoid_write_failure_disables_outputs() {
  FakePcaBus bus;
  spp::SolenoidDriver driver(bus);
  TEST_ASSERT_TRUE(driver.begin());
  bus.failWrite = true;
  TEST_ASSERT_FALSE(driver.setKey(0, false, 0));
  TEST_ASSERT_FALSE(driver.ready());
  TEST_ASSERT_FALSE(bus.outputsEnabled);
}

void test_solenoid_all_off_attempts_every_board_after_failure() {
  FakePcaBus bus;
  spp::SolenoidDriver driver(bus);
  TEST_ASSERT_TRUE(driver.begin());
  bus.clearedBoards.clear();
  bus.failedClearBoard = 2;
  TEST_ASSERT_FALSE(driver.allOff());
  TEST_ASSERT_EQUAL_UINT32(6, bus.clearedBoards.size());
  TEST_ASSERT_FALSE(driver.ready());
  TEST_ASSERT_FALSE(bus.outputsEnabled);
}

void test_nano_rejects_corruption_and_unmapped_key() {
  FakeClock clock;
  RecordingOutput output(clock);
  spp::NanoController nano(output);
  nano.begin();

  spp::Frame frame = spp::makeRequest(spp::MessageType::kHeartbeat, 4);
  frame.bytes[4] ^= 1;
  nano.processFrame(frame, clock.nowMs());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::MessageType::kNack),
                          nano.response().bytes[2]);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::ErrorCode::kBadCrc),
                          nano.response().bytes[7]);

  nano.processFrame(spp::makeSyncClock(5, 0), clock.nowMs());
  nano.processFrame(
      spp::makeNote(spp::MessageType::kNoteOn, 6, 87, 100, 0),
      clock.nowMs());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::ErrorCode::kInvalidKey),
                          nano.response().bytes[7]);
  TEST_ASSERT_EQUAL_UINT8(0, nano.queuedEvents());
}

void test_nano_duplicate_sequence_executes_once() {
  FakeClock clock;
  RecordingOutput output(clock);
  spp::NanoController nano(output);
  nano.begin();
  nano.processFrame(spp::makeSyncClock(1, 0), clock.nowMs());
  const spp::Frame note =
      spp::makeNote(spp::MessageType::kNoteOn, 2, 4, 77, 0);
  nano.processFrame(note, clock.nowMs());
  nano.processFrame(note, clock.nowMs());
  TEST_ASSERT_EQUAL_UINT8(1, nano.queuedEvents());
  nano.tick(clock.nowMs());
  TEST_ASSERT_EQUAL_UINT32(1, output.actions.size());
  TEST_ASSERT_EQUAL_UINT8(77, output.actions[0].velocity);
}

void test_nano_full_queue_rejects_only_incoming_event() {
  FakeClock clock;
  RecordingOutput output(clock);
  spp::NanoController nano(output);
  nano.begin();
  nano.processFrame(spp::makeSyncClock(1, 0), clock.nowMs());
  for (uint8_t index = 0; index < spp::NanoController::kQueueCapacity;
       ++index) {
    nano.processFrame(
        spp::makeNote(spp::MessageType::kNoteOn,
                      static_cast<uint8_t>(index + 2), index, 50,
                      1000 + index),
        clock.nowMs());
    TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::MessageType::kAck),
                            nano.response().bytes[2]);
  }
  nano.processFrame(
      spp::makeNote(spp::MessageType::kNoteOn, 90, 1, 50, 2000),
      clock.nowMs());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::ErrorCode::kBufferFull),
                          nano.response().bytes[7]);
  TEST_ASSERT_EQUAL_UINT8(spp::NanoController::kQueueCapacity,
                          nano.queuedEvents());
}

void test_nano_watchdog_clears_active_outputs() {
  FakeClock clock;
  RecordingOutput output(clock);
  spp::NanoController nano(output);
  nano.begin();
  nano.processFrame(spp::makeSyncClock(1, 0), clock.nowMs());
  nano.processFrame(
      spp::makeNote(spp::MessageType::kNoteOn, 2, 0, 100, 0),
      clock.nowMs());
  nano.tick(clock.nowMs());
  TEST_ASSERT_TRUE(output.anyActive());
  clock.advance(spp::NanoController::kCommunicationTimeoutMs + 1);
  nano.tick(clock.nowMs());
  TEST_ASSERT_FALSE(output.anyActive());
  TEST_ASSERT_FALSE(nano.clockRunning());
}

void test_nano_output_failure_enters_hardware_error() {
  FakeClock clock;
  RecordingOutput output(clock);
  spp::NanoController nano(output);
  nano.begin();
  nano.processFrame(spp::makeSyncClock(1, 0), clock.nowMs());
  nano.processFrame(
      spp::makeNote(spp::MessageType::kNoteOn, 2, 0, 100, 0),
      clock.nowMs());
  output.failNextSet = true;
  nano.tick(clock.nowMs());
  TEST_ASSERT_FALSE(nano.clockRunning());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::MessageType::kNack),
                          nano.response().bytes[2]);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::ErrorCode::kHardwareUnavailable),
      nano.response().bytes[7]);
}

void test_transport_retries_lost_response_without_duplicate_event() {
  FakeClock clock;
  RecordingOutput output(clock);
  spp::NanoController nano(output);
  nano.begin();
  LoopbackSpiLink link(nano, clock);
  spp::SpiTransport transport(link, clock);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::SpiResult::kOk),
                          static_cast<uint8_t>(transport.syncClock(0)));
  link.hiddenResponses = 7;
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::SpiResult::kOk),
      static_cast<uint8_t>(transport.sendNote(true, 2, 88, 100)));
  TEST_ASSERT_EQUAL_UINT8(1, nano.queuedEvents());
  TEST_ASSERT_GREATER_THAN_UINT32(1, link.deliveredByType[
                                          static_cast<uint8_t>(
                                              spp::MessageType::kNoteOn)]);
}

void test_transport_recovers_from_one_corrupted_request() {
  FakeClock clock;
  RecordingOutput output(clock);
  spp::NanoController nano(output);
  nano.begin();
  LoopbackSpiLink link(nano, clock);
  spp::SpiTransport transport(link, clock);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::SpiResult::kOk),
                          static_cast<uint8_t>(transport.syncClock(0)));
  link.corruptNextCommand = true;
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::SpiResult::kOk),
      static_cast<uint8_t>(transport.sendNote(true, 2, 88, 100)));
  TEST_ASSERT_EQUAL_UINT8(1, nano.queuedEvents());
}

void test_playback_boot_fails_safe_when_nano_hardware_is_unavailable() {
  FakeClock clock;
  RecordingOutput output(clock);
  output.setReady(false);
  spp::NanoController nano(output);
  nano.begin();
  LoopbackSpiLink link(nano, clock);
  spp::SpiTransport transport(link, clock);
  spp::PlaybackController playback(transport, clock);
  playback.begin(0, 0);
  const spp::PlaybackSnapshot snapshot = playback.snapshot();
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kError),
                          static_cast<uint8_t>(snapshot.state));
  TEST_ASSERT_EQUAL_STRING("nano_unavailable", snapshot.errorCode);
  TEST_ASSERT_GREATER_OR_EQUAL_UINT32(3000, clock.nowMs());
}

void test_complete_playback_reaches_expected_outputs_and_feedback() {
  EmbeddedHarness system;
  system.start({
      {100, 200, 0, 42, 0},
      {150, 50, 1, 99, 0},
  });
  system.advance(180);
  const spp::PlaybackSnapshot playing = system.playback.snapshot();
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kPlaying),
                          static_cast<uint8_t>(playing.state));
  TEST_ASSERT_GREATER_OR_EQUAL_UINT32(150, playing.positionMs);
  TEST_ASSERT_EQUAL_UINT32(300, playing.durationMs);

  system.advance(250);
  TEST_ASSERT_EQUAL_UINT32(4, system.output.actions.size());
  TEST_ASSERT_TRUE(system.output.actions[0].on);
  TEST_ASSERT_EQUAL_UINT8(0, system.output.actions[0].keyIndex);
  TEST_ASSERT_EQUAL_UINT8(8, system.output.actions[0].output);
  TEST_ASSERT_EQUAL_UINT8(42, system.output.actions[0].velocity);
  TEST_ASSERT_TRUE(system.output.actions[1].on);
  TEST_ASSERT_FALSE(system.output.actions[2].on);
  TEST_ASSERT_FALSE(system.output.actions[3].on);
  const spp::PlaybackSnapshot completed = system.playback.snapshot();
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kIdle),
                          static_cast<uint8_t>(completed.state));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::SessionOutcome::kCompleted),
      static_cast<uint8_t>(completed.sessionOutcome));
  TEST_ASSERT_FALSE(system.output.anyActive());
}

void test_playback_activates_before_the_musical_strike() {
  EmbeddedHarness system;
  system.start({{100, 10, 2, 90, 0, 20}});
  const uint32_t initialPosition = system.playback.snapshot().positionMs;
  TEST_ASSERT_LESS_THAN_UINT32(80, initialPosition);
  system.advance(79 - initialPosition);
  TEST_ASSERT_FALSE(system.output.active[2]);
  TEST_ASSERT_EQUAL_UINT32(79, system.playback.snapshot().positionMs);
  system.advance(1);
  TEST_ASSERT_TRUE(system.output.active[2]);
  TEST_ASSERT_LESS_THAN_UINT32(100, system.playback.snapshot().positionMs);
  system.advance(29);
  TEST_ASSERT_TRUE(system.output.active[2]);
  system.advance(1);
  TEST_ASSERT_FALSE(system.output.active[2]);
}

void test_pause_resume_reactivates_sustained_note() {
  EmbeddedHarness system;
  system.start({{0, 1000, 3, 71, 0}});
  system.advance(200);
  TEST_ASSERT_TRUE(system.output.active[3]);

  spp::DesiredCommand pause = command(spp::CommandType::kPause, 2);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kAccepted),
      static_cast<uint8_t>(system.playback.handle(pause)));
  TEST_ASSERT_FALSE(system.output.anyActive());
  const uint32_t pausedPosition = system.playback.snapshot().positionMs;
  system.clock.advance(100);

  spp::DesiredCommand resume = command(spp::CommandType::kResume, 3);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kAccepted),
      static_cast<uint8_t>(system.playback.handle(resume)));
  system.advance(5);
  TEST_ASSERT_TRUE(system.output.active[3]);
  TEST_ASSERT_EQUAL_UINT8(71, system.output.actions.back().velocity);
  const uint32_t resumedPosition = system.playback.snapshot().positionMs;
  TEST_ASSERT_GREATER_OR_EQUAL_UINT32(pausedPosition, resumedPosition);
  TEST_ASSERT_LESS_OR_EQUAL_UINT32(pausedPosition + 30, resumedPosition);
  system.advance(900);
  TEST_ASSERT_FALSE(system.output.anyActive());
}

void test_stop_is_idempotent_and_clears_outputs() {
  EmbeddedHarness system;
  system.start({{0, 1000, 4, 80, 0}});
  system.advance(20);
  TEST_ASSERT_TRUE(system.output.anyActive());
  spp::DesiredCommand stop = command(spp::CommandType::kStop, 2);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kAccepted),
      static_cast<uint8_t>(system.playback.handle(stop)));
  TEST_ASSERT_FALSE(system.output.anyActive());
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::SessionOutcome::kStopped),
      static_cast<uint8_t>(system.playback.snapshot().sessionOutcome));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kDuplicate),
      static_cast<uint8_t>(system.playback.handle(stop)));
}

void test_stop_rejects_a_stale_session() {
  EmbeddedHarness system;
  system.start({{0, 1000, 4, 80, 0}});
  system.advance(20);
  spp::DesiredCommand stop = command(spp::CommandType::kStop, 2);
  copyId(stop.sessionId, sizeof(stop.sessionId),
         "99999999-9999-4999-8999-999999999999");
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kRejected),
      static_cast<uint8_t>(system.playback.handle(stop)));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kPlaying),
                          static_cast<uint8_t>(system.playback.snapshot().state));
  TEST_ASSERT_TRUE(system.output.anyActive());
}

void test_emergency_recovery_ignores_session_mismatch_and_clears_outputs() {
  EmbeddedHarness system;
  system.start({{0, 1000, 4, 80, 0}});
  system.advance(20);
  TEST_ASSERT_TRUE(system.output.anyActive());

  spp::DesiredCommand recover = command(spp::CommandType::kEmergencyRecover, 2);
  copyId(recover.sessionId, sizeof(recover.sessionId),
         "99999999-9999-4999-8999-999999999999");
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kAccepted),
      static_cast<uint8_t>(system.playback.handle(recover)));
  const spp::PlaybackSnapshot snapshot = system.playback.snapshot();
  TEST_ASSERT_FALSE(system.output.anyActive());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kIdle),
                          static_cast<uint8_t>(snapshot.state));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::SessionOutcome::kStopped),
      static_cast<uint8_t>(snapshot.sessionOutcome));
  TEST_ASSERT_EQUAL_STRING(recover.sessionId, snapshot.sessionId);
}

void test_safe_controller_restart_waits_in_stopping_after_all_off() {
  EmbeddedHarness system;
  system.start({{0, 1000, 4, 80, 0}});
  system.advance(20);

  spp::DesiredCommand restart = command(spp::CommandType::kRestartController, 2);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kRestartController),
      static_cast<uint8_t>(system.playback.handle(restart)));
  const spp::PlaybackSnapshot snapshot = system.playback.snapshot();
  TEST_ASSERT_FALSE(system.output.anyActive());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kStopping),
                          static_cast<uint8_t>(snapshot.state));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::AcknowledgementResult::kAccepted),
      static_cast<uint8_t>(snapshot.acknowledgementResult));
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::SessionOutcome::kStopped),
      static_cast<uint8_t>(snapshot.sessionOutcome));
}

void test_emergency_recovery_failure_stays_in_error_until_watchdog_all_off() {
  EmbeddedHarness system;
  system.start({{0, 1000, 4, 80, 0}});
  system.advance(20);
  system.link.block(spp::MessageType::kFlushAllOff);

  spp::DesiredCommand recover = command(spp::CommandType::kEmergencyRecover, 2);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kRejected),
      static_cast<uint8_t>(system.playback.handle(recover)));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kError),
                          static_cast<uint8_t>(system.playback.snapshot().state));
  TEST_ASSERT_TRUE(system.output.anyActive());

  system.advance(spp::NanoController::kCommunicationTimeoutMs + 500);
  TEST_ASSERT_FALSE(system.output.anyActive());
}

void test_restart_replays_from_zero_and_clears_current_notes() {
  EmbeddedHarness system;
  system.start({{100, 300, 7, 90, 0}});
  system.advance(160);
  TEST_ASSERT_TRUE(system.output.active[7]);
  const size_t firstPassActions = system.output.actions.size();
  spp::DesiredCommand restart = command(spp::CommandType::kRestart, 2);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kAccepted),
      static_cast<uint8_t>(system.playback.handle(restart)));
  TEST_ASSERT_FALSE(system.output.anyActive());
  TEST_ASSERT_LESS_OR_EQUAL_UINT32(10,
                                  system.playback.snapshot().positionMs);
  system.advance(130);
  TEST_ASSERT_TRUE(system.output.active[7]);
  TEST_ASSERT_GREATER_THAN_UINT32(firstPassActions,
                                  system.output.actions.size());
}

void test_artifact_failure_reports_error_and_stop_recovers() {
  EmbeddedHarness system;
  spp::DesiredCommand play = command(spp::CommandType::kPlay);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kDownloadArtifact),
      static_cast<uint8_t>(system.playback.handle(play)));
  system.playback.artifactFailed(play, "download interrupted");
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kError),
                          static_cast<uint8_t>(system.playback.snapshot().state));
  TEST_ASSERT_EQUAL_STRING("artifact_download_failed",
                           system.playback.snapshot().errorCode);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::SessionOutcome::kFailed),
      static_cast<uint8_t>(system.playback.snapshot().sessionOutcome));

  spp::DesiredCommand stop = command(spp::CommandType::kStop, 2);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kAccepted),
      static_cast<uint8_t>(system.playback.handle(stop)));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kIdle),
                          static_cast<uint8_t>(system.playback.snapshot().state));
  TEST_ASSERT_EQUAL_STRING("", system.playback.snapshot().errorCode);
}

void test_dense_playback_uses_backpressure_without_event_loss() {
  std::vector<spp::ArtifactNote> notes;
  for (uint16_t index = 0; index < 100; ++index) {
    notes.push_back({static_cast<uint32_t>(index * 8), 20,
                     static_cast<uint8_t>(index % 17),
                     static_cast<uint8_t>(40 + index % 100), 0});
  }
  EmbeddedHarness system;
  system.start(notes);
  system.advance(1200);
  TEST_ASSERT_EQUAL_UINT32(200, system.output.actions.size());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kIdle),
                          static_cast<uint8_t>(system.playback.snapshot().state));
  TEST_ASSERT_FALSE(system.output.anyActive());
}

void test_error_path_stops_heartbeats_and_nano_watchdog_clears_key() {
  EmbeddedHarness system;
  system.start({{0, 1000, 5, 90, 0}});
  system.advance(100);
  TEST_ASSERT_TRUE(system.output.anyActive());
  system.link.block(spp::MessageType::kNoteOff);
  system.link.block(spp::MessageType::kFlushAllOff);
  system.advance(300);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kError),
                          static_cast<uint8_t>(system.playback.snapshot().state));
  const uint32_t heartbeats = system.link.deliveredByType[
      static_cast<uint8_t>(spp::MessageType::kHeartbeat)];
  TEST_ASSERT_TRUE(system.output.anyActive());

  system.advance(spp::NanoController::kCommunicationTimeoutMs + 500);
  TEST_ASSERT_FALSE(system.output.anyActive());
  TEST_ASSERT_EQUAL_UINT32(
      heartbeats,
      system.link.deliveredByType[
          static_cast<uint8_t>(spp::MessageType::kHeartbeat)]);
}

void test_playback_survives_millisecond_counter_wraparound() {
  EmbeddedHarness system;
  system.clock.set(std::numeric_limits<uint32_t>::max() - 100);
  system.start({{50, 40, 6, 64, 0}});
  system.advance(200);
  TEST_ASSERT_EQUAL_UINT32(2, system.output.actions.size());
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::DeviceState::kIdle),
                          static_cast<uint8_t>(system.playback.snapshot().state));
  TEST_ASSERT_FALSE(system.output.anyActive());
}

void test_commands_enforce_revision_session_and_state() {
  EmbeddedHarness system;
  spp::DesiredCommand pause = command(spp::CommandType::kPause, 1);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kRejected),
      static_cast<uint8_t>(system.playback.handle(pause)));
  TEST_ASSERT_EQUAL_STRING("session_mismatch",
                           system.playback.snapshot().acknowledgementErrorCode);

  spp::DesiredCommand expired = command(spp::CommandType::kPlay, 2);
  expired.expired = true;
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kRejected),
      static_cast<uint8_t>(system.playback.handle(expired)));
  TEST_ASSERT_EQUAL_STRING("command_expired",
                           system.playback.snapshot().acknowledgementErrorCode);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kDuplicate),
      static_cast<uint8_t>(system.playback.handle(expired)));
}

void test_play_rejects_incompatible_profile_without_advancing_applied_revision() {
  EmbeddedHarness system;
  spp::DesiredCommand play = command(spp::CommandType::kPlay);
  play.profileVersion = 3;
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::CommandHandling::kRejected),
      static_cast<uint8_t>(system.playback.handle(play)));
  const spp::PlaybackSnapshot snapshot = system.playback.snapshot();
  TEST_ASSERT_EQUAL_UINT32(0, snapshot.lastAppliedRevision);
  TEST_ASSERT_EQUAL_UINT32(1, snapshot.lastHandledRevision);
  TEST_ASSERT_EQUAL_UINT8(
      static_cast<uint8_t>(spp::AcknowledgementResult::kRejected),
      static_cast<uint8_t>(snapshot.acknowledgementResult));
}

}  // namespace

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_artifact_accepts_valid_records);
  RUN_TEST(test_artifact_accepts_legacy_v1_without_activation_lead);
  RUN_TEST(test_artifact_rejects_incompatible_profile_version);
  RUN_TEST(test_command_expiry_uses_epoch_seconds_without_date_parsing);
  RUN_TEST(test_durable_status_queue_preserves_order_and_rejects_overflow);
  RUN_TEST(test_artifact_rejects_bad_header_and_count);
  RUN_TEST(test_artifact_rejects_malformed_note_data);
  RUN_TEST(test_artifact_rejects_more_than_ten_simultaneous_notes);
  RUN_TEST(test_event_queue_wraps_without_losing_order);
  RUN_TEST(test_legacy_mapping_covers_every_logical_key);
  RUN_TEST(test_solenoid_initialization_requires_every_board_and_stays_disabled);
  RUN_TEST(test_solenoid_initialization_clears_all_six_boards_before_enable);
  RUN_TEST(test_solenoid_mapping_reversal_velocity_and_note_off);
  RUN_TEST(test_solenoid_write_failure_disables_outputs);
  RUN_TEST(test_solenoid_all_off_attempts_every_board_after_failure);
  RUN_TEST(test_nano_rejects_corruption_and_unmapped_key);
  RUN_TEST(test_nano_duplicate_sequence_executes_once);
  RUN_TEST(test_nano_full_queue_rejects_only_incoming_event);
  RUN_TEST(test_nano_watchdog_clears_active_outputs);
  RUN_TEST(test_nano_output_failure_enters_hardware_error);
  RUN_TEST(test_transport_retries_lost_response_without_duplicate_event);
  RUN_TEST(test_transport_recovers_from_one_corrupted_request);
  RUN_TEST(test_playback_boot_fails_safe_when_nano_hardware_is_unavailable);
  RUN_TEST(test_complete_playback_reaches_expected_outputs_and_feedback);
  RUN_TEST(test_playback_activates_before_the_musical_strike);
  RUN_TEST(test_pause_resume_reactivates_sustained_note);
  RUN_TEST(test_stop_is_idempotent_and_clears_outputs);
  RUN_TEST(test_stop_rejects_a_stale_session);
  RUN_TEST(test_emergency_recovery_ignores_session_mismatch_and_clears_outputs);
  RUN_TEST(test_safe_controller_restart_waits_in_stopping_after_all_off);
  RUN_TEST(test_emergency_recovery_failure_stays_in_error_until_watchdog_all_off);
  RUN_TEST(test_restart_replays_from_zero_and_clears_current_notes);
  RUN_TEST(test_artifact_failure_reports_error_and_stop_recovers);
  RUN_TEST(test_dense_playback_uses_backpressure_without_event_loss);
  RUN_TEST(test_error_path_stops_heartbeats_and_nano_watchdog_clears_key);
  RUN_TEST(test_playback_survives_millisecond_counter_wraparound);
  RUN_TEST(test_commands_enforce_revision_session_and_state);
  RUN_TEST(test_play_rejects_incompatible_profile_without_advancing_applied_revision);
  return UNITY_END();
}
