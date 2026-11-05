#pragma once

#include <stdint.h>

#ifdef __AVR__
#include <avr/pgmspace.h>
#define SPP_PROGMEM PROGMEM
#else
#define SPP_PROGMEM
#endif

namespace spp {

constexpr uint8_t kPianoKeyCount = 88;
constexpr uint8_t kUnmappedOutput = 0xFF;

const uint8_t kLegacyV1KeyMap[kPianoKeyCount] SPP_PROGMEM = {
    8,  9,  10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55,
    56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
    72, 73, 74, 75, 76, 77, 78, 79, 80, 82, 83, 84, 85, 86, 87, 88,
    89, 90, 91, 92, 93, 94, 95, kUnmappedOutput,
};

inline uint8_t outputForKey(uint8_t keyIndex) {
  if (keyIndex >= kPianoKeyCount) return kUnmappedOutput;
#ifdef __AVR__
  return pgm_read_byte(&kLegacyV1KeyMap[keyIndex]);
#else
  return kLegacyV1KeyMap[keyIndex];
#endif
}

}  // namespace spp

#undef SPP_PROGMEM
