/*
 * File:          esp32_c.ino
 * Author:        Ding Jérémy
 * Date:          2025-04-07
 *
 * Description:   Main control program for the Arachnova bot.
 *                This file handles SPI communication as a master to the arduino (slave) and
 *                sets up an ESP32-based WiFi access point. A built-in web interface
 *                allows users to remotely control the bot.
 *
 * Modifications:
 * Date:
 * Changes:
 */

//-------------- INCLUDES ---------------
#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include "LittleFS.h"
#include <Arduino_JSON.h>
#include <SPI.h>

//-------------- DEFINES ---------------
#define D_UART_BAUDRATE 115200

// SPI pins
#define D_SPI_CLK 14
#define D_SPI_MISO 12
#define D_SPI_MOSI 13
#define D_SPI_SS 15
#define D_SPI_BAUDRATE 500000

// SPI buffer sizes
#define D_SPI_BUFFSIZE 5

// WiFi credentials
#define D_SSID "Self-playing-piano"
#define D_PASSWORD "1234"

//-------------- ENUMS ---------------
typedef enum
{
  E_SPI_COMM_NOOPERA = 0x00, // No operation
} E_SPI_COMM;

//-------------- ENUMS ---------------

// Define a frame structure
typedef struct __attribute__((packed))
{
  E_SPI_COMM command : 8;
  uint8_t data;
  int16_t data_2 : 16;
} S_FRAME;

typedef union
{
  S_FRAME bits;
  uint8_t bytes[D_SPI_BUFFSIZE];
} U_FRAME;

//-------------- FUNCTION PROTOTYPES ---------------
void init_littlefs();
void init_wifi();
void init_spi();

void notify_clients(String msg);
void handle_websocket_message(void *arg, uint8_t *data, size_t len);
void send_slider_to_spi(bool is_servo, int left_value, int right_value);
void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len);
void init_websocket();

U_FRAME send_frame(U_FRAME tx_frame);
void control_servo(int16_t angle);
void control_steppers(int16_t speed);
void calibrate();
void demo();
void update_colors(uint8_t r, uint8_t g, uint8_t b);
void send_user_info(bool connected);
int16_t map_angle_value(int16_t joystick_value);
U_FRAME request_bat();

//-------------- GLOBAL VARIABLES ---------------
AsyncWebServer server(80); // Web server
AsyncWebSocket ws("/ws");  // WebSocket endpoint

int16_t angle = 0; // Servo angle
int16_t speed = 0; // Robot speed

unsigned long last_battery_check = 0;
bool is_calibrating = false;
bool is_reading_bat = false;
bool is_treating_msg = false;
//-------------- SETUP FUNCTION ---------------
void setup()
{
  Serial.begin(D_UART_BAUDRATE); // Open serial port
  init_spi();
  init_wifi();
  init_littlefs();
  init_websocket();

  // Serve root HTML
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request)
            { request->send(LittleFS, "/index.html", "text/html"); });

  // Serve static files
  server.serveStatic("/", LittleFS, "/");

  server.begin();
}

//-------------- MAIN LOOP ---------------
void loop()
{
  // Perform battery updates
  if (millis() - last_battery_check >= D_BAT_UPDATE && !is_treating_msg)
  {
    last_battery_check = millis();

    U_FRAME battery_infos = request_bat(); // Get battery voltage in millivolts
    // Check that the received message is indeed the battery lvls
    if (battery_infos.bits.command == E_SPI_COMM_REQSBAT)
    {
      // Create JSON message
      JSONVar json;
      json["id"] = "battery";
      json["voltage"] = battery_infos.bits.data_1;
      json["percentage"] = battery_infos.bits.data_2;

      String msg = JSON.stringify(json);
      notify_clients(msg); // Send over WebSocket
    }
  }
}

//-------------- FUNCTION IMPLEMENTATIONS ---------------

/*
 * Sends a 5-byte frame to the SPI slave device, reads the response
 */
U_FRAME send_frame(U_FRAME tx_frame)
{
  U_FRAME rx_frame;
  SPI.beginTransaction(SPISettings(D_SPI_BAUDRATE, MSBFIRST, SPI_MODE0));
  digitalWrite(D_SPI_SS, LOW);
  delay(1);

  // First received byte is trash
  SPI.transfer(tx_frame.bytes[0]);
  for (int i = 1; i < D_SPI_BUFFSIZE; i++)
  {
    rx_frame.bytes[i - 1] = SPI.transfer(tx_frame.bytes[i]);
  }
  // Send last dummy byte to receive the last data info
  rx_frame.bytes[D_SPI_BUFFSIZE - 1] = SPI.transfer(0xFF);

  delay(1);
  digitalWrite(D_SPI_SS, HIGH);
  SPI.endTransaction();

  return rx_frame;
}

/*
 * Sends a request for battery voltage (mV)
 */

U_FRAME request_bat()
{
  // Raise flag
  is_reading_bat = true;

  U_FRAME tx_frame;
  U_FRAME rx_frame;
  tx_frame.bits.command = E_SPI_COMM_REQSBAT;
  tx_frame.bits.data_1 = 0xFFFF;
  tx_frame.bits.data_2 = 0xFFFF;
  send_frame(tx_frame);
  // Wait for the arduino to work [10 ms]
  delay(10);
  // Read the results
  tx_frame.bits.command = E_SPI_COMM_NOOPERA;
  rx_frame = send_frame(tx_frame);

  is_reading_bat = false;
  return rx_frame;
}

/*
 * Sends a servo control frame to the SPI slave
 */
void control_servo(int16_t angle)
{
  U_FRAME frame;
  frame.bits.command = E_SPI_COMM_CTRLSRV;
  frame.bits.data_1 = angle;
  frame.bits.data_2 = 0xFFFF;
  send_frame(frame);
}

/*
 * Sends a stepper motor control frame to the SPI slave
 */
void control_steppers(int16_t speed)
{
  U_FRAME frame;
  frame.bits.command = E_SPI_COMM_CTRLMOT;
  frame.bits.data_1 = speed;
  frame.bits.data_2 = 0xFFFF;
  send_frame(frame);
}

/*
 * Sends a calibration command to the nano to configure the stepper positions at their "home positions"
 */
void calibrate()
{
  U_FRAME frame;
  frame.bits.command = E_SPI_COMM_CALIBRT;
  frame.bits.data_1 = 0xFFFF;
  frame.bits.data_2 = 0xFFFF;
  send_frame(frame);
}

/*
 * Initializes the LittleFS file system
 */
void init_littlefs()
{
  if (!LittleFS.begin(true))
  {
    Serial.println("An error has occurred while mounting LittleFS");
  }
  else
  {
    Serial.println("LittleFS mounted successfully");
  }
}

/*
 * Initializes the ESP32 in Access Point mode
 */
void init_wifi()
{
  WiFi.mode(WIFI_AP);
  WiFi.softAP(D_SSID, D_PASSWORD);
  Serial.println("Starting Access Point...");
  Serial.print("IP Address: ");
  Serial.println(WiFi.softAPIP());
}

/*
 * Sends a text message to all connected WebSocket clients
 */
void notify_clients(String msg)
{
  ws.textAll(msg);
}

/*
 * Handles incoming WebSocket messages from the client
 */
void handle_websocket_message(void *arg, uint8_t *data, size_t len)
{
  // Get frame infos
  AwsFrameInfo *info = (AwsFrameInfo *)arg;

  // Check if the system is currently reading battery from the arduino
  if (is_reading_bat)
  {
    return;
  }
  is_treating_msg = true;
  // Check if the received websocket message is valid
  if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT)
  {
    // Parse Data and Message.
    String message = (char *)data;
    JSONVar msg = JSON.parse(message);

    // If the received message is correct
    if (JSON.typeof(msg) == "object")
    {
      String ctrl_id = (const char *)msg["id"];
      String type = (const char *)msg["type"];

      // Check what action to take based on the received msg.
      if (ctrl_id == "button-Calibrate")
      {
        calibrate();
      }
      else if (ctrl_id == "button-Demo")
      {
        demo();
      }
      else if (ctrl_id == "eyes-color")
      {
        update_colors(msg["r"], msg["g"], msg["b"]);
      }
      else if (ctrl_id == "joystick-right")
      {
        angle = map_angle_value(msg["x"]);
        control_steppers(speed);
        control_servo(angle);
      }
      else if (ctrl_id == "joystick-left")
      {
        speed = msg["y"];
        control_steppers(speed);
        control_servo(angle);
      }
    }
  }
  is_treating_msg = false;
}

/*
 * WebSocket event callback handler
 */
void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len)
{
  switch (type)
  {
  case WS_EVT_CONNECT:
    Serial.printf("WebSocket client #%u connected from %s\n", client->id(), client->remoteIP().toString().c_str());
    send_user_info(true);
    break;
  case WS_EVT_DISCONNECT:
    Serial.printf("WebSocket client #%u disconnected\n", client->id());
    send_user_info(false);
    break;
  case WS_EVT_DATA:
    handle_websocket_message(arg, data, len);
    break;
  case WS_EVT_PONG:
  case WS_EVT_ERROR:
    break;
  }
}

/*
 * Initializes the WebSocket server and binds events
 */
void init_websocket()
{
  ws.onEvent(on_event);
  server.addHandler(&ws);
}

/*
 * Maps a joystick value from [-100, 100] to [0, 180] for servo angle
 */
int16_t map_angle_value(int16_t joystick_value)
{
  return (joystick_value + 100) * 180 / 200;
}

/*
 * Initializes the SPI interface with predefined pins
 */
void init_spi()
{
  pinMode(D_SPI_SS, OUTPUT);
  digitalWrite(D_SPI_SS, HIGH);
  SPI.begin(D_SPI_CLK, D_SPI_MISO, D_SPI_MOSI, D_SPI_SS);
}

/*
 * Sends a frame to inform about a user
 */
void send_user_info(bool connected)
{
  U_FRAME frame;
  frame.bits.command = E_SPI_COMM_CONNECT;
  frame.bits.data_1 = connected;
  frame.bits.data_2 = 0xFFFF;
  send_frame(frame);
}

/*
 * Sends a frame to indicate the robot to set demo mode
 */
void demo()
{
  U_FRAME frame;
  frame.bits.command = E_SPI_COMM_DEMO;
  send_frame(frame);
}

/*
 * Update the color on the robot's eyes
 */
void update_colors(uint8_t r, uint8_t g, uint8_t b)
{
  U_FRAME frame;
  frame.bits.command = E_SPI_COMM_COLOR;
  frame.bits.data_1 = b | g << 8;
  frame.bits.data_2 = r;
  send_frame(frame);
}