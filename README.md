# 🎖 Yossi WarZone Control PRO

**Israel Emergency Warning System — Real-time Intelligence Hub**

Source: [warwatch-guardian-hub](https://github.com/YossiKat/warwatch-guardian-hub)

## Quick Start
```bash
cp .env.example .env   # הוסף טוקנים
npm install
node server.js         # שרת על port 3000
node tg_user.js        # TG User על port 3001
```

## Live
- Dashboard: http://localhost:3000/warwatch.html
- API: http://localhost:3000/api/

## Features
- 🗺 ESRI Satellite HD Map + Globe intro
- 📡 OREF Real-time (8s polling)
- ✈️ 3 Telegram Bots (RED/GOLD/BLUE)
- 📱 TG User API (78 groups)
- 🤖 AI Analysis (Claude Sonnet)
- 🌋 USGS Earthquakes
- 🌪 NASA EONET Disasters
- ⚓ Maritime Intel (Suez/Hormuz)
- 🌊 Sea Conditions (7 beaches)
- 🚗 CarPlay + Hebrew TTS
