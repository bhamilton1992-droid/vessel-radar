const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const AIS_KEY = (process.env.AISSTREAM_API_KEY || '').replace(/["']/g, '').trim();

app.use(express.static(path.join(__dirname, 'public')));

let aisSocket = null;
let currentBoundingBox = null;

function sendAISSubscription() {
  if (!aisSocket || aisSocket.readyState !== WebSocket.OPEN) return;

  // If user hasn't sent custom viewport yet, default to local/regional box
  const box = currentBoundingBox || [[36.0, -90.0], [33.0, -85.0]];

  const subscription = {
    APIKey: AIS_KEY,
    BoundingBoxes: [box],
    FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport"]
  };

  try {
    aisSocket.send(JSON.stringify(subscription));
    console.log(`[AISStream] Subscribed to viewport: N:${box[0][0].toFixed(2)}, W:${box[0][1].toFixed(2)} to S:${box[1][0].toFixed(2)}, E:${box[1][1].toFixed(2)}`);
  } catch (err) {
    console.error("Subscription send error:", err.message);
  }
}

function connectAISStream() {
  if (!AIS_KEY) {
    console.error("FATAL: AISSTREAM_API_KEY is empty on Render!");
    return;
  }

  console.log(`Connecting to AISStream...`);
  aisSocket = new WebSocket("wss://stream.aisstream.io/v0/stream", {
    perMessageDeflate: true
  });

  aisSocket.on("open", () => {
    console.log("Connected to AISStream!");
    sendAISSubscription();
  });

  aisSocket.on("message", (raw) => {
    const payload = raw.toString();
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  });

  aisSocket.on("close", (code, reason) => {
    console.log(`AISStream closed [Code: ${code}]. Reconnecting in 5s...`);
    setTimeout(connectAISStream, 5000);
  });

  aisSocket.on("error", (err) => {
    console.error("AISStream error:", err.message);
  });
}

connectAISStream();

// Handle connections from your browser/phone
wss.on('connection', (client) => {
  console.log("Client browser connected.");

  client.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'SET_BOUNDS' && data.box) {
        currentBoundingBox = data.box;
        sendAISSubscription();
      }
    } catch (e) {
      // Ignore bad packets
    }
  });
});

server.listen(PORT, () => {
  console.log(`Radar server listening on port ${PORT}`);
});
