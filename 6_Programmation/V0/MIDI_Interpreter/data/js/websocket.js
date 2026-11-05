/*
*
*/

function initWebSocket() {
  websocket = new WebSocket(gateway);

  websocket.onopen = () => {
    console.log("WebSocket connected");
  };

  websocket.onclose = () => {
    console.log("WebSocket disconnected, retrying...");
    //setTimeout(initWebSocket, 2000); // Retry connection
  };

  websocket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.id === "battery") {
        console.log(message);
      }
    } catch (error) {
      console.log("Received non-JSON message:", event.data);
    }
  };
}