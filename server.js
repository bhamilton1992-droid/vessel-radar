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

// Keep an active cache of recent vessels (MMSI -> vessel data)
const vesselCache = new Map();

// Prune vessels not heard from in 45 minutes
setInterval(() => {
  const cutoff = Date.now() - (45 * 60 * 1000);
  for (const [mmsi, data] of vesselCache.entries()) {
    if (data.lastSeen < cutoff) vesselCache.delete(mmsi);
  }
}, 60000);

function sendAISSubscription() {
  if (!aisSocket || aisSocket.readyState !== WebSocket.OPEN) return;
  const box = currentBoundingBox || [[36.5, -90.5], [33.0, -84.5]];

  const subscription = {
    APIKey: AIS_KEY,
    BoundingBoxes: [box],
    FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport"]
  };

  try {
    aisSocket.send(JSON.stringify(subscription));
  } catch (err) {
    console.error("Subscription error:", err.message);
  }
}

function connectAISStream() {
  if (!AIS_KEY) return;
  aisSocket = new WebSocket("wss://stream.aisstream.io/v0/stream", { perMessageDeflate: true });

  aisSocket.on("open", () => {
    sendAISSubscription();
  });

  aisSocket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const type = msg.MessageType;
      const meta = msg.MetaData;

      if (type === "PositionReport" || type === "StandardClassBPositionReport") {
        const report = msg.Message?.[type];
        const mmsi = meta?.MMSI;
        const lat = meta?.Latitude ?? meta?.latitude;
        const lon = meta?.Longitude ?? meta?.longitude;

        if (mmsi && lat && lon) {
          vesselCache.set(mmsi, {
            mmsi,
            lat,
            lon,
            heading: report.TrueHeading === 511 || report.TrueHeading === undefined ? (report.Cog || 0) : report.TrueHeading,
            sog: report.Sog || 0,
            cog: report.Cog || 0,
            name: meta?.ShipName?.trim() || `MMSI ${mmsi}`,
            lastSeen: Date.now()
          });
        }
      }

      // Broadcast update
      const payload = raw.toString();
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      });
    } catch (e) {}
  });

  aisSocket.on("close", () => setTimeout(connectAISStream, 5000));
  aisSocket.on("error", () => {});
}

connectAISStream();

wss.on('connection', (client) => {
  // 1. Immediately dump cached fleet into newly opened browser
  const snapshot = Array.from(vesselCache.values());
  client.send(JSON.stringify({ type: 'SNAPSHOT', vessels: snapshot }));

  client.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'SET_BOUNDS' && data.box) {
        currentBoundingBox = data.box;
        sendAISSubscription();
      }
    } catch (e) {}
  });
});

server.listen(PORT, () => console.log(`Listening on :${PORT}`));
