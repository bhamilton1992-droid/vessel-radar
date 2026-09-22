const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
// Strip any accidental quotes or whitespace
const AIS_KEY = (process.env.AISSTREAM_API_KEY || '').replace(/["']/g, '').trim();

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

let aisSocket = null;
function connectAISStream() {
  if (!AIS_KEY) {
    console.error("FATAL: AISSTREAM_API_KEY is empty on Render!");
    return;
  }

  console.log(`Connecting to AISStream with key: ${AIS_KEY.substring(0, 4)}****`);

  // Connect with perMessageDeflate compression
  aisSocket = new WebSocket("wss://stream.aisstream.io/v0/stream", {
    perMessageDeflate: true
  });

  aisSocket.on("open", () => {
    console.log("Connected to AISStream! Sending subscription...");

    // Official AISStream subscription format: 3D Array [[[lat1, lon1], [lat2, lon2]]]
    const subscription = {
      APIKey: AIS_KEY,
      BoundingBoxes: [
        // US Gulf Coast & Lower Mississippi River Hub (High density, active 24/7)
        [[30.5, -91.5], [28.5, -88.5]],
        // Florida & East Coast
        [[32.0, -82.0], [24.5, -79.0]]
      ],
      FilterMessageTypes: ["PositionReport"]
    };

    aisSocket.send(JSON.stringify(subscription));
    console.log("Subscription payload dispatched.");
  });

  let messageCount = 0;
  aisSocket.on("message", (raw) => {
    messageCount++;
    if (messageCount === 1) {
      console.log("SUCCESS: First live AIS packet received from AISStream!");
    } else if (messageCount % 25 === 0) {
      console.log(`Live feed active: relayed ${messageCount} vessels...`);
    }

    const payload = raw.toString();
    // Forward directly to browser / phone
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  });

  aisSocket.on("close", (code, reason) => {
    console.log(`AISStream closed [Code: ${code}] Reason: ${reason ? reason.toString() : 'None'}. Reconnecting in 5s...`);
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
