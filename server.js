const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const AIS_KEY = (process.env.AISSTREAM_API_KEY || '').trim();

// Serve static web files
app.use(express.static(path.join(__dirname, 'public')));

let aisSocket = null;
function connectAISStream() {
  if (!AIS_KEY) {
    console.error("FATAL: AISSTREAM_API_KEY environment variable is missing or empty!");
    return;
  }

  console.log(`Connecting to AISStream with key: ${AIS_KEY.substring(0, 4)}****`);
  
  // AISStream requires perMessageDeflate compression
  aisSocket = new WebSocket("wss://stream.aisstream.io/v0/stream", {
    perMessageDeflate: true
  });

  aisSocket.on("open", () => {
    console.log("Connected to AISStream! Sending subscription...");
    
    // Exact format required: [[[NorthLat, WestLon], [SouthLat, EastLon]]]
    const subscription = {
      APIKey: AIS_KEY,
      BoundingBoxes: [
        // US Gulf Coast & Inland River Basins (New Orleans, Houston, Mobile, MS/TN/OH Rivers)
        [[[36.5, -95.0], [24.5, -84.0]]],
        // US East Coast (Florida up to New York / Chesapeake)
        [[[41.5, -82.0], [25.0, -70.0]]],
        // US West Coast (SoCal up to Puget Sound)
        [[[49.0, -125.0], [32.0, -117.0]]]
      ],
      FilterMessageTypes: ["PositionReport"]
    };
    
    aisSocket.send(JSON.stringify(subscription));
    console.log("Subscription sent successfully!");
    
    let packetCount = 0;
  aisSocket.on("message", (raw) => {
    packetCount++;
    if (packetCount % 50 === 0) {
      console.log(`Relayed ${packetCount} live AIS frames...`);
    }
    const payload = raw.toString();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  });

  aisSocket.on("message", (raw) => {
    // Forward live stream to all connected phones/browsers
    const payload = raw.toString();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  });

  aisSocket.on("close", (code, reason) => {
    console.log(`AISStream connection closed [Code: ${code}] Reason: ${reason ? reason.toString() : 'None'}. Reconnecting in 5s...`);
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
