# jomato

**Instant push alerts for Zomato Food Rescue — before anyone else gets there.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](index.js)

---

## What is Zomato Food Rescue?

Food Rescue is Zomato's feature where cancelled or excess restaurant orders become available at a steep discount — sometimes 50–80% off. They appear in the app for a very short window and are gone in seconds.

The problem: by the time you open the app and check, it's already claimed.

**jomato** fixes that. It runs on a server, connects to Zomato's internal MQTT feed, and the moment a Food Rescue event fires for your address — your phone buzzes instantly via [ntfy.sh](https://ntfy.sh).

---

## How it works

1. One-time OTP login via your Zomato phone number
2. Select your delivery address from your saved addresses
3. Connects to Zomato's internal MQTT broker and subscribes to the Food Rescue channel for your area
4. On `order_cancelled` event → sends push notification to your phone via ntfy.sh
5. Runs headlessly forever, auto-reconnects on drops

**Smart alert logic:**
- Deduplicates by message ID — no double alerts
- Claim suppression window — if an order is immediately claimed, the alert is suppressed (avoids false positives)
- Stale message filter — ignores events older than 2 minutes

---

## Setup

### Prerequisites
- Node.js 18+
- [ntfy.sh](https://ntfy.sh) app installed on your phone
- A Zomato account with at least one saved delivery address

### 1. Clone and install

```bash
git clone https://github.com/nav-ios/jomato.git
cd jomato
npm install
```

### 2. Configure

Edit `index.js` and set:

```js
const PHONE_NUMBER = process.env.ZOMATO_PHONE || YOUR_PHONE_NUMBER;
const NTFY_TOPIC = process.env.NTFY_TOPIC || your-ntfy-topic;
```

Or use environment variables (recommended):

```bash
export ZOMATO_PHONE=9999999999
export NTFY_TOPIC=my-jomato-alerts
```

Pick any unique string for `NTFY_TOPIC` — open the ntfy app on your phone and subscribe to the same topic name.

### 3. First run (interactive)

```bash
npm start
```

- Enter the OTP sent to your phone
- Select your delivery address from the list
- Wait for MQTT connected — you're live

Config is cached to `state/settings.json`. Future runs skip the OTP and address selection entirely.

### 4. Run headlessly (PM2)

```bash
npm install -g pm2
cp ecosystem.config.js ecosystem.local.js
# edit ecosystem.local.js with your phone and ntfy topic
pm2 start ecosystem.local.js
pm2 save
pm2 startup
```

---

## Multiple users

Each user needs their own `STATE_DIR` to keep sessions separate:

```bash
# First-time interactive setup for a friend
ZOMATO_PHONE=9999999999 NTFY_TOPIC=friend-alerts STATE_DIR=state-friend node index.js
```

Then add a second entry in `ecosystem.config.js` (see the commented-out template inside).

---

## ntfy setup

1. Install [ntfy](https://ntfy.sh) on your iPhone or Android
2. Subscribe to your chosen topic (e.g. `my-jomato-alerts`)
3. Set the same topic in `NTFY_TOPIC`

Free. No account needed. Self-hostable if you want.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ZOMATO_PHONE` | — | Your Zomato-registered phone number |
| `NTFY_TOPIC` | — | ntfy topic to push alerts to |
| `STATE_DIR` | `state` | Folder to store session cache and dedup state |
| `NTFY_TITLE` | auto | Custom push notification title |
| `NTFY_MESSAGE` | auto | Custom push notification body |
| `NTFY_SERVER_LABEL` | hostname | Label shown in notification to identify the server |

---

## License

MIT
