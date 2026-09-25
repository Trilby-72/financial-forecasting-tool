const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { buildForecast, applyScenario, getDefaultData } = require('./forecasting');

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'forecast.json');

app.use(cors());
app.use(express.json());

function ensureSeedData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(getDefaultData(), null, 2));
  }
}

function readData() {
  ensureSeedData();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return getDefaultData();
  }
}

function writeData(data) {
  ensureSeedData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'financial-forecasting-tool' });
});

app.get('/api/forecast', (req, res) => {
  const data = readData();
  const forecast = buildForecast(data, { months: 12 });
  res.json({ data, forecast });
});

app.post('/api/forecast/scenario', (req, res) => {
  const scenario = req.body || {};
  const currentData = readData();
  const nextData = applyScenario(currentData, scenario);
  writeData(nextData);
  const forecast = buildForecast(nextData, { months: 12 });
  res.json({ data: nextData, forecast });
});

app.post('/api/forecast/reset', (req, res) => {
  const seedData = getDefaultData();
  writeData(seedData);
  const forecast = buildForecast(seedData, { months: 12 });
  res.json({ data: seedData, forecast });
});

const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

app.listen(PORT, () => {
  console.log(`Financial forecasting tool listening on http://localhost:${PORT}`);
});
