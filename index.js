const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Bot Token
const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';

// API URLs
const koyebApiAudio = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play?url=';
const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

// Watermark URL
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

// Keep-alive URLs
let keepAliveUrls = [
    'https://vivekfy-meta-bot-1.onrender.com',
    'https://vivekfy-v2.onrender.com'
];

// Bot instance
const bot = new TelegramBot(botToken, { polling: true });

/**
 * **Alive Command: Add Keep-Alive URL**
 */
bot.onText(/\/alive (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newUrl = match[1].trim();

    if (!keepAliveUrls.includes(newUrl)) {
        keepAliveUrls.push(newUrl);
        await bot.sendMessage(chatId, `✅ Added to keep-alive list: ${newUrl}`);
    } else {
        await bot.sendMessage(chatId, `⚠️ URL already exists in the list.`);
    }
});

/**
 * **Remove Command: Remove Keep-Alive URL**
 */
bot.onText(/\/remove (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const removeUrl = match[1].trim();

    if (keepAliveUrls.includes(removeUrl)) {
        keepAliveUrls = keepAliveUrls.filter(url => url !== removeUrl);
        await bot.sendMessage(chatId, `❌ Removed from keep-alive list: ${removeUrl}`);
    } else {
        await bot.sendMessage(chatId, `⚠️ URL not found in the list.`);
    }
});

/**
 * **Keep Alive Request**
 */
function keepAlive() {
    setInterval(async () => {
        for (const url of keepAliveUrls) {
            try {
                await axios.get(url);
                console.log(`✅ Keep-alive request sent to ${url}`);
            } catch (error) {
                console.error(`❌ Keep-alive request failed for ${url}:`, error.message);
            }
        }
    }, 240000);
}

keepAlive();

/**
 * **Process Audio with Progress Update**
 */
async function processAudioWithWatermark(audioUrl, coverUrl, title, artist, chatId) {
    const coverImagePath = 'cover.jpg';
    const watermarkAudioPath = 'watermark.mp3';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        const watermarkAudioResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkAudioPath, watermarkAudioResponse.data);

        const coverImageResponse = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverImagePath, coverImageResponse.data);

        await bot.sendMessage(chatId, '⏳ Processing audio...');

        return new Promise((resolve, reject) => {
            let lastSentProgress = 0;
            
            ffmpeg()
                .input(audioUrl)
                .input(watermarkAudioPath)
                .input(coverImagePath)
                .complexFilter([
                    '[0]volume=1[a]',
                    '[1]adelay=10000|10000,volume=8.5[b]',
                    '[a][b]amix=inputs=2'
                ])
                .outputOptions([
                    '-metadata', `title=${title}`,
                    '-metadata', `artist=${artist}`,
                    '-map', '0:a',
                    '-map', '2:v',
                    '-c:v', 'mjpeg',
                    '-vf', "drawtext=text='vivekfy':fontcolor=#000000:fontsize=40:box=1:boxcolor=#ffffff@0.9:x=(W-text_w)/2:y=H*0.8-text_h"
                ])
                .save(finalOutputName)
                .on('progress', (progress) => {
                    const percentage = Math.round(progress.percent);
                    if (percentage >= lastSentProgress + 10) {
                        bot.sendMessage(chatId, `🔄 Processing: ${percentage}%`);
                        lastSentProgress = percentage;
                    }
                })
                .on('end', async () => {
                    fs.unlinkSync(coverImagePath);
                    fs.unlinkSync(watermarkAudioPath);
                    resolve(finalOutputName);
                })
                .on('error', (err) => {
                    console.error('Error adding watermark:', err);
                    reject(err);
                });
        });
    } catch (error) {
        console.error('Error:', error);
        throw new Error('Error processing audio.');
    }
}

/**
 * **Settings Command**
 */
bot.onText(/\/setting/, async (msg) => {
    const chatId = msg.chat.id;
    const settingsMessage = `
🔧 **Settings**
🎥 Thumbnail Quality:
1️⃣ Default (hqdefault)
2️⃣ Medium (mqdefault)
3️⃣ Standard (sddefault)
4️⃣ Max Resolution (maxresdefault)

📌 Developer: *Vivek Masona*
    `;
    await bot.sendMessage(chatId, settingsMessage, { parse_mode: "Markdown" });
});

/**
 * **Express Server (Keep Bot Alive)**
 */
app.get('/', (req, res) => {
    res.send('🤖 Bot is running...');
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
