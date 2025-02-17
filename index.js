const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Bot Token & API Keys
const botToken = 'YOUR_TELEGRAM_BOT_TOKEN';
const youtubeApiKey = 'YOUR_YOUTUBE_API_KEY';

// ✅ API URLs
const koyebApiAudio = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play?url=';
const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

// ✅ Permanent URLs for Keep-Alive
const permanentUrls = [
    'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play',
    'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json'
];

// ✅ User Saved URLs
let userAliveUrls = [];

// ✅ User Settings Storage
let userSettings = {}; // Format: { chatId: { editMode: "auto" | "manual" } }

// ✅ Create Bot Instance
const bot = new TelegramBot(botToken, { polling: true });

/**
 * **🌐 Keep-Alive Request**
 */
function keepAlive() {
    [...permanentUrls, ...userAliveUrls].forEach(url => {
        axios.get(url)
            .then(() => console.log(`✅ Keep-alive: ${url}`))
            .catch(() => console.log(`❌ Failed: ${url}`));
    });
}
setInterval(keepAlive, 5 * 60 * 1000); // Every 5 minutes

/**
 * **📡 `/alive` Command (Store & Show URLs)**
 */
bot.onText(/\/alive(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const newUrl = match[1]?.trim();

    if (newUrl) {
        if (!userAliveUrls.includes(newUrl)) {
            userAliveUrls.push(newUrl);
            bot.sendMessage(chatId, `✅ URL added for keep-alive: ${newUrl}`);
        } else {
            bot.sendMessage(chatId, `ℹ️ URL already exists: ${newUrl}`);
        }
    } else {
        const allUrls = [...permanentUrls, ...userAliveUrls].join('\n');
        bot.sendMessage(chatId, `🌐 **Alive URLs:**\n${allUrls}`);
    }
});

/**
 * **⚙️ `/settings` Command (User Preferences)**
 */
bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Auto Edit", callback_data: "edit_auto" }],
                [{ text: "Manual Edit", callback_data: "edit_manual" }]
            ]
        }
    };
    bot.sendMessage(chatId, "⚙️ **Choose Edit Mode:**", options);
});

bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const choice = callbackQuery.data;

    if (choice === "edit_auto" || choice === "edit_manual") {
        userSettings[chatId] = { editMode: choice.split("_")[1] };
        bot.sendMessage(chatId, `✅ Edit mode set to: ${userSettings[chatId].editMode}`);
    }
});

/**
 * **🔍 YouTube Search**
 */
async function searchYouTube(query, chatId) {
    try {
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(query)}&key=${youtubeApiKey}`;
        const response = await axios.get(searchUrl);
        const videos = response.data.items;

        if (videos.length > 0) {
            const options = {
                reply_markup: {
                    inline_keyboard: videos.map(video => [{
                        text: video.snippet.title,
                        callback_data: video.id.videoId
                    }])
                }
            };
            bot.sendMessage(chatId, '🔍 Search Results:', options);
        } else {
            bot.sendMessage(chatId, '❌ No results found.');
        }
    } catch (error) {
        bot.sendMessage(chatId, '⚠️ Error searching YouTube.');
    }
}

/**
 * **🎵 Process Audio & Add Watermark**
 */
async function processAudioWithWatermark(audioUrl, thumbnailUrl, title, artist, chatId) {
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
    const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

    try {
        await bot.sendMessage(chatId, "⏳ Processing Audio (0%)...");
        const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync('audio.mp3', audioResponse.data);

        const watermarkResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync('watermark.mp3', watermarkResponse.data);

        await bot.sendMessage(chatId, "🔄 Processing Audio (50%)...");

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input('audio.mp3')
                .input('watermark.mp3')
                .complexFilter('[0:a]volume=1[a];[1:a]volume=0.5[b];[a][b]amix=inputs=2')
                .outputOptions([
                    '-metadata', `title=${title}`,
                    '-metadata', `artist=${artist}`,
                    '-codec:a', 'libmp3lame'
                ])
                .save(finalOutputName)
                .on('end', async () => {
                    bot.sendMessage(chatId, "✅ Processing Completed (100%)!");
                    resolve(finalOutputName);
                })
                .on('error', (err) => reject(err));
        });
    } catch (error) {
        throw new Error("❌ Error Processing Audio.");
    }
}

/**
 * **🎶 Fetch & Process YouTube Audio**
 */
async function fetchAndProcessAudio(chatId, videoId) {
    try {
        const metadataUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${youtubeApiKey}`;
        const response = await axios.get(metadataUrl);
        const video = response.data.items[0].snippet;

        const title = video.title;
        const artist = video.channelTitle;
        const thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        const audioJsonUrl = koyebApiJson + encodeURIComponent(`https://youtu.be/${videoId}`);
        const audioJsonResponse = await axios.get(audioJsonUrl);
        const audioUrl = audioJsonResponse.data.audio_url;

        const processedFile = await processAudioWithWatermark(audioUrl, thumbnail, title, artist, chatId);
        await bot.sendAudio(chatId, processedFile);

        fs.unlinkSync(processedFile);
    } catch (error) {
        bot.sendMessage(chatId, "❌ Error Fetching Audio.");
    }
}

/**
 * **📝 Handle Messages**
 */
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const query = msg.text;

    if (query.startsWith('http')) {
        const videoId = query.split('v=')[1]?.split('&')[0];
        if (videoId) {
            await fetchAndProcessAudio(chatId, videoId);
        } else {
            bot.sendMessage(chatId, "❌ Invalid YouTube URL.");
        }
    } else {
        await searchYouTube(query, chatId);
    }
});

app.get('/', (req, res) => res.send('Bot Running'));
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
