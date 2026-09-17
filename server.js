const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const AIS_KEY = process.env.AISSTREAM_API_KEY || '';

// Serve static web files
app.use(express.static(path.join(__dirname, 'public')));

// Connect to AISStream.io server-side
let aisSocket = null;
function connectAISStream() {
  if (!AIS_KEY) {
    console.warn("No AISSTREAM_API_KEY set. Ingestion paused.");
    return;
  }

  console.log("Connecting to AISStream.io...");
  aisSocket = new WebSocket("wss://stream.aisstream.io/v0/stream");

  aisSocket.on("open", () => {
    console.log("Connected to AISStream! Subscribing...");
    // Worldwide bounding box (or narrow down as needed)
    const subscription = {
      APIKey: AIS_KEY,
      BoundingBoxes: [[[-90.0, -180.0], [90.0, 180.0]]],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"]
    };
    aisSocket.send(JSON.stringify(subscription));
  });

  aisSocket.on("message", (raw) => {
    // Broadcast live packets to all connected phones/browsers
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw.toString());
      }
    });
  });

  aisSocket.on("close", () => {
    console.log("AISStream connection closed. Reconnecting in 5s...");
    setTimeout(connectAISStream, 5000);
  });

  aisSocket.on("error", (err) => {
    console.error("AISStream error:", err.message);
  });
}

connectAISStream();

server.listen(PORT, () => {
  console.log(`Radar server listening on port ${PORT}`);
});
