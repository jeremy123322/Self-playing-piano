/*
 * File:          main.cpp
 * Author:        Ding Jérémy
 * Date:          01.2026
 *
 * Description:   Main control program for the MIDI interpreter of the self-playing piano.
 *                The role of this ESP is to hold the web server that controls the UI, handles
 *                midi inputs as form of notes.
 *                Send commands to the arduino responsible for controlling the actual solenoids.
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
#include <SPI.h>
#include <Arduino_JSON.h>
#include <queue>

//-------------- DEFINES ---------------
#define D_UART_BAUDRATE 115200

// SPI pins
#define D_SPI_CLK 14
#define D_SPI_MISO 12
#define D_SPI_MOSI 13
#define D_SPI_SS 32
#define D_SPI_BAUDRATE 500000

// SPI buffer sizes
#define D_SPI_BUFFSIZE 8

// WiFi credentials
#define D_SSID "SPP"
#define D_PASSWORD "1234"

// Notes buffer
#define NOTE_BUFFER 50

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

//-------------- FUNCTION PROTOTYPES ---------------
void init_littlefs();
void init_wifi();
void init_spi();

void notify_clients(String msg);
void handle_websocket_message(void *arg, uint8_t *data, size_t len);
void on_event(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len);
void init_websocket();

U_FRAME send_frame(U_FRAME tx_frame);
void send_frame_2(U_FRAME tx_frame);

//-------------- GLOBAL VARIABLES ---------------
AsyncWebServer server(80); // Web server
AsyncWebSocket ws("/ws");  // WebSocket endpoint

// Note queue
std::queue<S_NOTE> note_queue;
uint8_t g_test = 0;

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
    /*U_FRAME note_frame;
    S_NOTE n;
    n.midi = 22;
    n.time = 1000;
    n.on = 1;
    n.vel = 10;

    note_frame.bits.command = E_SPI_COMM_NOTE;
    note_frame.bits.note = n;
    Serial.println("Sending note:");
    Serial.print(note_frame.bits.note.midi);
    Serial.print(" - ");
    Serial.print(note_frame.bits.note.time);
    Serial.print(" - ");
    Serial.print(note_frame.bits.note.on);
    Serial.print(" - ");
    Serial.print(note_frame.bits.note.vel);
    Serial.println("");

    send_frame_2(note_frame);
    delay(1000);*/
}

//-------------- FUNCTION IMPLEMENTATIONS ---------------

/*
 * Sends a 5-byte frame to the SPI slave device, reads the response
 */
void send_frame_2(U_FRAME tx_frame)
{
    uint8_t frame[D_SPI_BUFFSIZE];

    frame[0] = tx_frame.bits.command;
    frame[1] = tx_frame.bits.note.midi;
    frame[2] = tx_frame.bits.note.on;
    frame[3] = tx_frame.bits.note.vel;

    uint32_t time = tx_frame.bits.note.time;
    frame[4] = (time >> 0) & 0xFF;
    frame[5] = (time >> 8) & 0xFF;
    frame[6] = (time >> 16) & 0xFF;
    frame[7] = (time >> 24) & 0xFF;

    SPI.beginTransaction(SPISettings(D_SPI_BAUDRATE, MSBFIRST, SPI_MODE0));
    digitalWrite(D_SPI_SS, LOW);
    delay(1);

    for (int i = 0; i < D_SPI_BUFFSIZE; i++)
    {
        SPI.transfer(frame[i]);
    }
    delay(1);
    digitalWrite(D_SPI_SS, HIGH);
    SPI.endTransaction();
}

U_FRAME send_frame(U_FRAME tx_frame)
{
    U_FRAME rx_frame;
    SPI.beginTransaction(SPISettings(D_SPI_BAUDRATE, MSBFIRST, SPI_MODE0));
    digitalWrite(D_SPI_SS, LOW);
    delay(1);

    for (int i = 0; i < D_SPI_BUFFSIZE; i++)
    {
        SPI.transfer(tx_frame.bytes[i]);
    }
    delay(1);
    digitalWrite(D_SPI_SS, HIGH);
    SPI.endTransaction();

    return rx_frame;
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
    // Check if the received websocket message is valid
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT)
    {
        // Parse Data and Message.
        String message = (char *)data;
        JSONVar obj = JSON.parse(message);
        // Read ws message
        if (obj.hasOwnProperty("type"))
        {
            String type = (const char *)obj["type"];

            if (type == "track_info")
            {
                S_TRACK_INFO info;
                info.ticksPerBeat = (uint16_t)obj["data"]["ticksPerBeat"];
                info.tempo = (uint16_t)obj["data"]["tempo"];
            }
            else if (type == "event")
            {
                // Read note info
                S_NOTE n;
                n.midi = (uint8_t)obj["data"]["midi"];
                n.time = (uint32_t)obj["data"]["time"];
                n.vel = (uint8_t)obj["data"]["velocity"];
                n.on = (uint8_t)obj["data"]["on"];
                // Send note info to arduino
                U_FRAME note_frame;

                note_frame.bits.command = E_SPI_COMM_NOTE;
                note_frame.bits.note = n;
                Serial.println("Sending note:");
                Serial.print(note_frame.bits.note.midi);
                Serial.print(" - ");
                Serial.print(note_frame.bits.note.time);
                Serial.print(" - ");
                Serial.print(note_frame.bits.note.on);
                Serial.print(" - ");
                Serial.print(note_frame.bits.note.vel);
                Serial.println("");
                send_frame_2(note_frame);
            }
            else if (type == "pause")
            {
                U_FRAME pause_frame;
                pause_frame.bits.command = E_SPI_COMM_PAUSE;
                send_frame_2(pause_frame);
            }
            else if (type == "resume")
            {
                U_FRAME resume_frame;
                resume_frame.bits.command = E_SPI_COMM_RESUME;
                resume_frame.bits.note.time = (uint32_t)obj["data"]["time"];
                send_frame_2(resume_frame);
            }
            else if (type == "restart")
            {
                U_FRAME restart_frame;
                restart_frame.bits.command = E_SPI_COMM_RESTART;
                send_frame_2(restart_frame);
            }
        }
    }
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
        break;
    case WS_EVT_DISCONNECT:
        Serial.printf("WebSocket client #%u disconnected\n", client->id());
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
 * Initializes the SPI interface with predefined pins
 */
void init_spi()
{
    pinMode(D_SPI_SS, OUTPUT);
    digitalWrite(D_SPI_SS, HIGH);
    SPI.begin(D_SPI_CLK, D_SPI_MISO, D_SPI_MOSI, D_SPI_SS);
}
