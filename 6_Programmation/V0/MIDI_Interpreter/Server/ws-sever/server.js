const WebSocket = require("ws");
const server = new WebSocket.Server({ port: 8080 });

function map(x, in_min, in_max, out_min, out_max) {
  return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
}

// Function to simulate battery data
function getBatteryData() {
  // Simulate battery voltage (13000 mV to 14800 mV)
  const voltage = (Math.random() * (14800 - 13000) + 13000).toFixed(1); // Random voltage between 3.0V and 4.2V
  const percentage = Math.round(map(voltage, 13000, 14800, 0, 100));
  // Return the battery data as an object
  return {
    id: "battery",
    percentage: percentage,
    voltage: voltage,
  };
}

server.on("connection", (socket) => {
  console.log("Client connected");


  socket.on("message", (message) => {
    console.log(`Received: ${message}`);
    // Send a JSON response
    socket.send(JSON.stringify({ response: `You said: ${message}` }));
  });

  // Handle socket closure (cleanup)
  socket.on("close", () => {
    console.log("Client disconnected");
    clearInterval(batteryDataInterval); // Stop sending battery data when the client disconnects
  });
});

console.log("WebSocket server running on ws://localhost:8080");
