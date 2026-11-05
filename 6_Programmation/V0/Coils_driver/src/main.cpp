/*
* name:     main.cpp
  author:   Ding Jérémy
*/

#include <Arduino.h>
#include <Adafruit_PWMServoDriver.h>

//-------------- DEFINES ---------------
#define D_OE_PIN 4
#define D_SERIAL_BAUD 9600 // bit/s
#define D_I2C_SPEED 100000 // bit/s

#define D_PWM_FREQ 100 // Hz

// Adress of PCA devices
#define D_PCA0_ADDR 0x40
#define D_PCA1_ADDR 0x41
#define D_PCA2_ADDR 0x42
#define D_PCA3_ADDR 0x43
#define D_PCA4_ADDR 0x44
#define D_PCA5_ADDR 0x45
#define D_PCA6_ADDR 0x46
#define D_PCA_ALL_ADDR 0x70

#define D_SPI_BUFFSIZE 8

#define D_NOTES_BUFFER_SIZE 100 // Notes buffer size

#define D_PHASE_ACC_DURATION 20 // Solenoid acceleration [ms]

#define D_NOTES_LEN 88 // Number of notes

#define D_NOTE_OFFSET 8

//-------------- ENUMS ---------------
typedef enum
{
  E_SPI_COMM_NOOPERA = 0x00, // No operation
  E_SPI_COMM_NOTE = 0x01,    // Note info
  E_SPI_COMM_ALL_OFF = 0x02, // Turn all solenoid off
  E_SPI_COMM_START = 0x03,   // Start playing the notes, (reset timer)
  E_SPI_COMM_PAUSE = 0x04,   // Pause the music
  E_SPI_COMM_RESUME = 0x05,  // Resume the music
  E_SPI_COMM_RESTART = 0x06  // Restart the music
} E_SPI_COMM;

//-------------- STRUCTS / UNION ---------------

typedef struct
{
  uint8_t midi;  // 0 - 88, physical notes of the piano
  uint8_t on;    // 1 = On, 0 = off
  uint32_t time; // [ms]
  uint8_t vel;   // Velocity [0-255]
} S_NOTE;

typedef struct
{
  uint16_t ticksPerBeat; // e.g., 480
  uint16_t tempo;        // BPM
} S_TRACK_INFO;

// TEST commit

// Define a frame structure
typedef struct __attribute__((packed))
{
  E_SPI_COMM command : 8;
  S_NOTE note;
} S_FRAME;

typedef union
{
  S_FRAME bits;
  uint8_t bytes[D_SPI_BUFFSIZE];
} U_FRAME;

//-------------- PROTOTYPES---------------
void i2c_scan();
void init_spi();
void all_off();
void remove_first_note();
void read_spi_buffer(U_FRAME *frame);

// Two boards with different I2C addresses
Adafruit_PWMServoDriver pca_0 = Adafruit_PWMServoDriver(D_PCA0_ADDR);
Adafruit_PWMServoDriver pca_1 = Adafruit_PWMServoDriver(D_PCA1_ADDR);
Adafruit_PWMServoDriver pca_2 = Adafruit_PWMServoDriver(D_PCA2_ADDR);
Adafruit_PWMServoDriver pca_3 = Adafruit_PWMServoDriver(D_PCA3_ADDR);
Adafruit_PWMServoDriver pca_4 = Adafruit_PWMServoDriver(D_PCA4_ADDR);
Adafruit_PWMServoDriver pca_5 = Adafruit_PWMServoDriver(D_PCA5_ADDR);

// Adafruit_PWMServoDriver pwm2 = Adafruit_PWMServoDriver(0x41);

//-------------- VARIABLES ---------------
uint8_t g_spi_buf_rx[D_SPI_BUFFSIZE];       // SPI receive buffer
volatile byte g_spi_buf_index;              // Index of SPI buffer
volatile boolean g_spi_msg_ready;           // Message ready flag
S_NOTE g_notes_buffer[D_NOTES_BUFFER_SIZE]; // Note buffer
uint8_t g_notes_buffer_index = 0;           // Note index (last note to play)

uint32_t g_current_time = 0; // Time to play midi
uint32_t g_resume_time = 0;  // Time of resuming
uint32_t g_midi_time = 0;    // Midi time (ms)
bool g_playing = false;      // Playing flag
void set_note_PWM(uint8_t note, uint16_t pwm);

uint16_t map_velocity(uint8_t velocity);

void setup()
{
  // Begin serial comm
  Serial.begin(D_SERIAL_BAUD);
  // intialize SPI comm
  init_spi();
  // Set the output enable pin
  pinMode(D_OE_PIN, OUTPUT);
  // Enable outputs
  digitalWrite(D_OE_PIN, 0);
  Wire.setClock(D_I2C_SPEED);

  i2c_scan();
  // Begin the PCA9685 pwm's
  pca_0.begin();
  pca_1.begin();
  pca_2.begin();
  pca_3.begin();
  pca_4.begin();
  pca_5.begin();

  // Set SCL speed

  // set totem pole output
  pca_0.setOutputMode(true);
  pca_1.setOutputMode(true);
  pca_2.setOutputMode(true);
  pca_3.setOutputMode(true);
  pca_4.setOutputMode(true);
  pca_5.setOutputMode(true);

  // set frequency
  pca_0.setPWMFreq(D_PWM_FREQ);
  pca_1.setPWMFreq(D_PWM_FREQ);
  pca_2.setPWMFreq(D_PWM_FREQ);
  pca_3.setPWMFreq(D_PWM_FREQ);
  pca_4.setPWMFreq(D_PWM_FREQ);
  pca_5.setPWMFreq(D_PWM_FREQ);

  // Perform blinking
  for (uint8_t i = 0; i < D_NOTES_BUFFER_SIZE; i++)
  {
    set_note_PWM(i, 0);
  }

  // Perform blinking
}

//-------------- MAIN LOOP ---------------

void loop()
{
  // Reset buffer index and message flag
  // Treat incoming spi message
  if (g_spi_msg_ready)
  {
    g_spi_buf_index = 0;
    g_spi_msg_ready = false;
    U_FRAME rx_frame;
    read_spi_buffer(&rx_frame);

    // Check what type of message is received
    switch (rx_frame.bits.command)
    {
    case E_SPI_COMM_NOOPERA:
      break;
    case E_SPI_COMM_RESTART:
      Serial.println("Restarting");
      // Empty buffer, save resume time.
      g_notes_buffer_index = 0;
      g_resume_time = millis(); // Save current time of resumal
      g_midi_time = 0;          // Set midi to 0
      // Serial.print(rx_frame.bits.note.time);
      break;
    case E_SPI_COMM_ALL_OFF:
      all_off();
      break;
    case E_SPI_COMM_PAUSE:
      // Receive a pause command
      if (g_playing)
      {
        // Turn all the solenoids off
        all_off();
        Serial.println("paused");
        g_playing = false;
      }
      break;

    case E_SPI_COMM_RESUME:
      // Resume command, comes with the current midi time (sent by server)
      if (!g_playing)
      {
        // Systems keeps playing
        g_playing = true;
        /*Serial.println("playing");
        Serial.print("Current time: ");*/

        g_resume_time = millis(); // Save current time of resumal
        /*Serial.print(rx_frame.bits.note.time);
        Serial.println("");*/
        g_midi_time = rx_frame.bits.note.time; // Get midi time at resumal
      }
      break;

    case E_SPI_COMM_NOTE:
      g_notes_buffer[g_notes_buffer_index] = rx_frame.bits.note;
      g_notes_buffer_index++;

      if (g_notes_buffer_index >= D_NOTES_BUFFER_SIZE)
      {
        Serial.println("Note buffer overflow");
        g_notes_buffer_index = 0;
      }
      break;

    default:
      break;
    }
  }
  // Run solenoids if playing
  if (g_playing)
  {
    // Get client time calculation (current time)
    g_current_time = millis() - g_resume_time + g_midi_time;

    // Check for solenoids to start in the futur buffer
    while (g_notes_buffer_index > 0)
    {
      S_NOTE &note = g_notes_buffer[0];

      if (note.time > g_current_time)
        break; // earliest note is still in the future

      // --- Execute note ---
      if (note.midi >= 0 && note.midi < D_NOTES_LEN)
      {
        // Shifts note above 80
        if (note.midi + D_NOTE_OFFSET > 80)
          note.midi++;
        if (note.on)
        {
          set_note_PWM(note.midi + D_NOTE_OFFSET, 4095);
        }
        else
        {
          set_note_PWM(note.midi + D_NOTE_OFFSET, 0);
        }
      }
      // --- Remove note from buffer ---
      remove_first_note();
    }
  }
}

//-------------- INTERRUPTS ---------------
ISR(SPI_STC_vect)
{
  byte c = SPDR; // Read incoming SPI byte

  if (g_spi_buf_index < D_SPI_BUFFSIZE - 1)
  {
    // Store the current value in a buffer (not the last dummy)
    g_spi_buf_rx[g_spi_buf_index] = c;
    // Sends the corresponding tx (DUMMY)
    SPDR = 0x00;
    g_spi_buf_index++;
  }
  else if (g_spi_buf_index == D_SPI_BUFFSIZE - 1)
  { // Last dummy byte received
    g_spi_msg_ready = true;
  }
}

//-------------- FUNCTIONS ---------------

/*
 * Scans for available addresses on the bus.
 * pass a 1D array of size 127.
 * 1 = Present
 * 0 = absent
 */
void i2c_scan()
{
  uint8_t index, error;
  for (index = 1; index < 128; index++)
  {
    Wire.beginTransmission(index);
    error = Wire.endTransmission();

    if (error == 0)
    {
      Serial.print("I2C device found at 0x");
      Serial.println(index, HEX);
    }
  }
}

/*
 * Init SPI module
 */
void init_spi()
{
  pinMode(MISO, OUTPUT);
  pinMode(MOSI, INPUT);
  pinMode(SCK, INPUT);
  pinMode(SS, INPUT);

  SPCR |= _BV(SPE);  // Enable SPI
  SPCR |= _BV(SPIE); // Enable SPI interrupt
}

/*
 * Turns all solenoids off
 */
void all_off()
{
  for (uint8_t i = 0; i < D_NOTES_LEN; i++)
  {
    set_note_PWM(i, 0);
  }
}

/*
 * Remove the first note of the note buffer (shifting all others)
 */
void remove_first_note()
{
  // Shift all remaining notes left by one
  for (uint8_t i = 1; i < g_notes_buffer_index; i++)
  {
    g_notes_buffer[i - 1] = g_notes_buffer[i];
  }

  g_notes_buffer_index--;
}

/*
 * Decode the spi buffer
 */
void read_spi_buffer(U_FRAME *frame)

{
  frame->bits.command = (E_SPI_COMM)g_spi_buf_rx[0];
  frame->bits.note.midi = g_spi_buf_rx[1];
  frame->bits.note.on = g_spi_buf_rx[2];
  frame->bits.note.vel = g_spi_buf_rx[3];

  uint32_t time =
      ((uint32_t)g_spi_buf_rx[4]) |
      ((uint32_t)g_spi_buf_rx[5] << 8) |
      ((uint32_t)g_spi_buf_rx[6] << 16) |
      ((uint32_t)g_spi_buf_rx[7] << 24);
  frame->bits.note.time = time;
}
/// @brief Sets current note pwm
/// @param note
/// @param pwm
void set_note_PWM(uint8_t note, uint16_t pwm)
{
  if (note < 16)
    pca_0.setPWM(15 - note, 0, pwm);
  else if (note < 32)
    pca_1.setPWM(15 - (note - 16), 0, pwm);
  else if (note < 48)
    pca_2.setPWM(15 - (note - 32), 0, pwm);
  else if (note < 64)
    pca_3.setPWM(15 - (note - 48), 0, pwm);
  else if (note < 80)
    pca_4.setPWM(15 - (note - 64), 0, pwm);
  else if (note < 96)
    pca_5.setPWM(15 - (note - 80), 0, pwm);
}

/// @brief Maps velocity from 0-255 to 1800-4095
/// @param velocity Value between 0 and 255
/// @return DAC/PWM value between 1800 and 4095
uint16_t map_velocity(uint8_t velocity)
{
  return 1800 + ((uint32_t)velocity * (4095 - 1800)) / 255;
}