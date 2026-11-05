#pragma once

#include <stdint.h>

namespace spp {

struct __attribute__((packed)) ScheduledEvent {
  uint32_t timeMs;
  uint8_t keyIndex;
  uint8_t velocity;
  bool on;
};

template <uint8_t Capacity>
class EventQueue {
 public:
  bool push(const ScheduledEvent& event) {
    if (size_ == Capacity) return false;
    events_[tail_] = event;
    tail_ = static_cast<uint8_t>((tail_ + 1) % Capacity);
    ++size_;
    return true;
  }

  const ScheduledEvent* front() const {
    return size_ == 0 ? nullptr : &events_[head_];
  }

  void pop() {
    if (size_ == 0) return;
    head_ = static_cast<uint8_t>((head_ + 1) % Capacity);
    --size_;
  }

  void clear() {
    head_ = 0;
    tail_ = 0;
    size_ = 0;
  }

  uint8_t size() const { return size_; }
  uint8_t freeSlots() const { return static_cast<uint8_t>(Capacity - size_); }

 private:
  ScheduledEvent events_[Capacity]{};
  uint8_t head_ = 0;
  uint8_t tail_ = 0;
  uint8_t size_ = 0;
};

}  // namespace spp
