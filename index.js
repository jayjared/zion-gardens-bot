// index.js
// Zion Gardens Hotel WhatsApp Bot (whatsapp-web.js)
// Behavior:
// - On first message from a chat: send services -> prices -> images -> instructions
// - If user types one of the directive keywords -> bot replies with company booking number(s)
// - If user types anything else -> bot forwards the message to Faith and Jared (receptionists)
// - If user replies "yes" to referral prompt -> bot sends receptionist notification to both numbers
// NOTE: place images in ./public/ (menu.jpg, room1.jpg, room2.jpg, pool.jpg, bar.jpg, playground.jpg)

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;

// Receptionist numbers (international format without +, Kenya)
const RECEPTIONISTS = [
  '254794112589', // Faith
  '254798596533'  // Jared
];

// Company booking numbers to show clients (you wanted the company number to call to book)
// Set them as strings (you can repeat the same receptionist if desired)
const COMPANY_BOOKING_NUMBERS = [
  '0794112589', // example; the bot will present these as dialable numbers in the reply
];

// Keywords that trigger booking/contact phone number reply
const DIRECTIVES = new Set([
  'book','booking','menu','bar','conference','playground','wedding','catering','rooms','room','prices'
]);

// Persistent greeted storage (so first-intro survives restarts)
const GREETED_FILE = './data/greeted.json';
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
let greeted = new Set();
try {
  const raw = fs.existsSync(GREETED_FILE) ? fs.readFileSync(GREETED_FILE, 'utf8') : null;
  if (raw) JSON.parse(raw).forEach(id => greeted.add(id));
} catch (e) { console.log('Could not load greeted file:', e.message); }

// Helper to save greeted set
function saveGreeted() {
  fs.writeFileSync(GREETED_FILE, JSON.stringify(Array.from(greeted)), 'utf8');
}

// Helper to load image as MessageMedia or return null if missing
function loadImage(p) {
  try {
    const f = path.resolve(p);
    if (!fs.existsSync(f)) return null;
    return MessageMedia.fromFilePath(f);
  } catch (e) {
    console.log('Image load error', p, e.message);
    return null;
  }
}

// Hotel content (editable)
const HOTEL_NAME = 'Zion Gardens Hotel';
const HOTEL_TAGLINE = 'Haven of Comfort and Luxury';
const HOTEL_LOCATION = 'Eldoret, Kenya';

const SERVICES_TEXT = `🏨 *${HOTEL_NAME}* — *${HOTEL_TAGLINE}*
📍 Location: ${HOTEL_LOCATION}

We offer the following services:
• Accommodation (Standard, Deluxe, Executive)
• Restaurant & Bar (Delicacies & cocktails)
• Swimming pool (Adults & Children)
• Children’s playground & Bouncing Castle
• Conference facilities (Full board)
• Catering services
• Wedding receptions & events
• Ample parking & serene environment
`;

const PRICES_TEXT = `💰 *Our Charges* (Bed & Breakfast per night / other rates):
• Standard Room – KES 3,500
• Deluxe Room – KES 4,500
• Executive Room – KES 6,500

• Half board – KES 1,600
• Full breakfast only – KES 800

• Swimming pool: Adults – KES 250 | Children – KES 200
• Bouncing Castle – KES 50 per child
• Conference (Full board) – KES 1,800
`;

const INSTRUCTIONS_TEXT = `You can type one of the following:
• 'book' or 'booking' — to get our booking phone number(s)
• 'menu' — to see the menu again
• 'bar' — to see drinks pictures
• 'conference' — conference booking info
• 'playground' — children's facilities
• 'wedding' — wedding reception packages
• 'catering' — catering services

If you want personal assistance, type 'yes' and I will notify our receptionists (Faith and Jared).`;

// Create Whatsapp client (LocalAuth stores session on disk)
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'zion-bot' // optional identifier (multiple sessions)
  }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
    headless: true
  }
});

// Show QR in logs if required
client.on('qr', qr => {
  console.log('--- QR code generated. Scan it with hotel WhatsApp phone ---');
  qrcode.generate(qr, { small: true });
});

// Once ready
client.on('ready', () => {
  console.log('✅ Zion Gardens Bot ready!');
});

// Helper: send booking phone numbers message
async function sendBookingNumbers(chatId) {
  const numbersText = COMPANY_BOOKING_NUMBERS.map(n => `📞 ${n}`).join('\n');
  const msg = `To make bookings, please call our booking line(s):\n${numbersText}\n\nIf you'd like, I can connect you to our receptionists (type 'yes').`;
  await client.sendMessage(chatId, msg);
}

// Helper: notify receptionists with client details
async function notifyReceptionists(clientContact, clientMessage) {
  const guestName = clientContact.pushname || 'Guest';
  const guestNumber = clientContact.number || 'unknown';
  const notification = `📩 *New Enquiry from Bot*\nName: ${guestName}\nNumber: ${guestNumber}\nMessage: ${clientMessage || '(no message)'}\nPlease assist.`;

  for (const r of RECEPTIONISTS) {
    const to = `${r}@c.us`;
    await client.sendMessage(to, notification).catch(e => console.log('Notify error for', r, e && e.message));
  }
}

// Main message handler
client.on('message', async msg => {
  try {
    const chatId = msg.from; // e.g., "2547...@c.us"
    const textRaw = (msg.body || '').trim();
    const text = textRaw.toLowerCase();

    // First-time intro flow (send services -> prices -> images -> instructions)
    if (!greeted.has(chatId)) {
      greeted.add(chatId);
      saveGreeted();

      // 1) Services
      await client.sendMessage(chatId, `Hello 👋, thank you for contacting *${HOTEL_NAME}* — *${HOTEL_TAGLINE}*.\n\n${SERVICES_TEXT}`);

      // 2) Prices
      await client.sendMessage(chatId, PRICES_TEXT);

      // 3) Send images (attempts; missing images are skipped)
      const images = [
        { file: './public/room1.jpg', caption: 'Standard / Deluxe Room' },
        { file: './public/room2.jpg', caption: 'Executive Room' },
        { file: './public/pool.jpg', caption: 'Swimming Pool' },
        { file: './public/playground.jpg', caption: 'Children\'s Playground & Bouncing Castle' },
        { file: './public/bar.jpg', caption: 'Bar Drinks' },
        { file: './public/menu.jpg', caption: 'Our Menu' }
      ];

      for (const im of images) {
        const media = loadImage(im.file);
        if (media) {
          await client.sendMessage(chatId, media, { caption: im.caption });
        }
      }

      // 4) Instructions & call to action
      await client.sendMessage(chatId, INSTRUCTIONS_TEXT);
      // Also offer referral
      await client.sendMessage(chatId, "Would you like me to refer you to our receptionists (Faith and Jared) for more assistance? Type 'yes' or 'no'.");
      return;
    }

    // If user types a DIRECTIVE -> send company booking phone number(s)
    if (DIRECTIVES.has(text) || [...DIRECTIVES].some(k => text.includes(k))) {
      await sendBookingNumbers(chatId);
      return;
    }

    // If user types 'yes' (referral) -> notify receptionists with client details and client's message
    if (text === 'yes' || text.includes('please connect') || text.includes('connect me') || text.includes('refer')) {
      const contact = await msg.getContact();
      await client.sendMessage(chatId, '✅ Okay — I am notifying our receptionists (Faith & Jared). They will contact you shortly.');
      await notifyReceptionists(contact, textRaw);
      return;
    }

    // If user types 'no' after referral prompt
    if (text === 'no' || text === 'not now') {
      await client.sendMessage(chatId, 'No problem — if you need anything later, type "yes" and I will notify our receptionists.');
      return;
    }

    // Support specific quick commands
    if (text === 'menu' || text === '!menu') {
      const m = loadImage('./public/menu.jpg');
      if (m) await client.sendMessage(chatId, m, { caption: '🍽️ Our Menu' });
      else await client.sendMessage(chatId, 'Menu not available right now.');
      return;
    }
    if (text === 'pool' || text === 'swimming' || text === 'swimming pool') {
      const m = loadImage('./public/pool.jpg');
      if (m) await client.sendMessage(chatId, m, { caption: '🏊 Swimming Pool — Adults KES 250 | Children KES 200' });
      else await client.sendMessage(chatId, 'Pool photos not available now.');
      return;
    }
    if (text === 'rooms' || text === 'room') {
      const r1 = loadImage('./public/room1.jpg');
      const r2 = loadImage('./public/room2.jpg');
      if (r1) await client.sendMessage(chatId, r1, { caption: 'Standard / Deluxe Room' });
      if (r2) await client.sendMessage(chatId, r2, { caption: 'Executive Room' });
      return;
    }

    // Anything else: forward the client's message to both receptionists
    const contact = await msg.getContact();
    await notifyReceptionists(contact, textRaw);

    await client.sendMessage(chatId, "Thanks — I've forwarded your message to our receptionists (Faith & Jared). They will contact you shortly for further assistance.");
  } catch (err) {
    console.error('Error in message handler:', err && err.message);
  }
});

client.initialize();

// Simple express server so Render sees a web process and keeps the container up
app.get('/', (req, res) => {
  res.send('Zion Gardens Hotel WhatsApp Bot is running.');
});

app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});
