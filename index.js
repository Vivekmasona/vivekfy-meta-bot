const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';
const youtubeApiKey = 'AIzaSyBX_-obwbQ3MZKeMTYS9x8SzjiXojl3nWs';
const bot = new TelegramBot(botToken, { polling: true });

const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

/**
 * **YouTube Search Function**
 */
async function searchYouTube(query) {
    try {
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${youtubeApiKey}`;
        const response = await axios.get(searchUrl);

        if (response.data.items.length === 0) return null;

        const firstVideo = response.data.items[0];
        return firstVideo.id.videoId;
    } catch (error) {
        console.error('YouTube Search Error:', error);
        return null;
    }
}

/**
 * **Fetch Best Thumbnail**
 */
async function getBestThumbnail(videoId) {
    const baseUrl = `https://i.ytimg.com/vi/${videoId}`;
    const qualityTags = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];

    let bestThumbnail = { url: '', size: 0 };

    for (const tag of qualityTags) {
        const thumbUrl = `${baseUrl}/${tag}.jpg`;

        try {
            const response = await axios.head(thumbUrl);
            const size = parseInt(response.headers['content-length'] || '0', 10);

            if (size > bestThumbnail.size) {
                bestThumbnail = { url: thumbUrl, size };
            }
        } catch (error) {
            console.log(`❌ Thumbnail not found: ${thumbUrl}`);
        }
    }

    return bestThumbnail;
}

/**
 * **Fetch & Process Audio**
 */
async function fetchAndProcessAudio(chatId, videoId) {
    try {
        const bestThumbnail = await getBestThumbnail(videoId);
        if (!bestThumbnail.url) throw new Error('No valid thumbnail found');

        const audioJsonUrl = koyebApiJson + encodeURIComponent(`https://youtu.be/${videoId}`);
        const audioJsonResponse = await axios.get(audioJsonUrl);
        const audioUrl = audioJsonResponse.data.audio_url;
        const audioSize = parseInt(audioJsonResponse.headers['content-length'] || '0', 10) / (1024 * 1024);

        if (!audioUrl) throw new Error('No audio URL found');

        await bot.sendMessage(chatId, `🎵 **Audio Found!**\n🖼 **Poster Size:** ${(bestThumbnail.size / (1024 * 1024)).toFixed(2)} MB\n⏳ **Processing...**`);

        await bot.sendAudio(chatId, audioUrl, { title: 'YouTube Audio', thumb: bestThumbnail.url });

    } catch (error) {
        console.error('Error fetching audio:', error);
        await bot.sendMessage(chatId, '❌ Error processing audio.');
    }
}

/**
 * **Handle Messages**
 */
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const query = msg.text.trim();

    await bot.sendMessage(chatId, '🔍 Searching on YouTube...');

    const videoId = await searchYouTube(query);
    if (videoId) {
        await fetchAndProcessAudio(chatId, videoId);
    } else {
        await bot.sendMessage(chatId, '❌ No results found.');
    }
});
