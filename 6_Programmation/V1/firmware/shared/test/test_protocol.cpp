#include <unity.h>

#include "spp_spi_protocol.h"

void setUp() {}
void tearDown() {}

void test_sync_clock_uses_payload_start() {
  const spp::Frame frame = spp::makeSyncClock(7, 1000);
  TEST_ASSERT_EQUAL_UINT8(0xE8, frame.bytes[4]);
  TEST_ASSERT_EQUAL_UINT8(0x03, frame.bytes[5]);
  TEST_ASSERT_EQUAL_UINT8(0x00, frame.bytes[6]);
  TEST_ASSERT_EQUAL_UINT8(0x00, frame.bytes[7]);
  TEST_ASSERT_EQUAL_UINT32(1000, spp::readUint32(&frame.bytes[4]));
}

void test_note_time_follows_key_and_velocity() {
  const spp::Frame frame = spp::makeNote(spp::MessageType::kNoteOn, 8, 42, 127, 0x12345678);
  TEST_ASSERT_EQUAL_UINT8(42, frame.bytes[4]);
  TEST_ASSERT_EQUAL_UINT8(127, frame.bytes[5]);
  TEST_ASSERT_EQUAL_UINT32(0x12345678, spp::readUint32(&frame.bytes[6]));
}

void test_crc_rejects_corruption() {
  spp::Frame frame = spp::makeRequest(spp::MessageType::kHeartbeat, 9);
  spp::ErrorCode error = spp::ErrorCode::kNone;
  TEST_ASSERT_TRUE(spp::validateFrame(frame, error));
  frame.bytes[4] ^= 0x01;
  TEST_ASSERT_FALSE(spp::validateFrame(frame, error));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(spp::ErrorCode::kBadCrc), static_cast<uint8_t>(error));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_sync_clock_uses_payload_start);
  RUN_TEST(test_note_time_follows_key_and_velocity);
  RUN_TEST(test_crc_rejects_corruption);
  return UNITY_END();
}
