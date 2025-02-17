const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 🔹 Bot & API Keys
const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';
const youtubeApiKey = 'AIzaSyBX_-obwbQ3MZKeMTYS9x8SzjiXojl3nWs';

// 🔹 API URLs
const koyebApiAudio = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play?url=';
const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

// 🔹 Watermark URL
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

// 📌 Initialize Telegram Bot
const bot = new TelegramBot(botToken, { polling: true });

/**
 * 🔍 **YouTube Search Function**
 */
async function searchYouTube(query, chatId) {
    try {
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(query)}&key=${youtubeApiKey}`;
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
            await bot.sendMessage(chatId, '🔍 Search Results:', options);
        } else {
            await bot.sendMessage(chatId, '❌ No results found.');
        }
    } catch (error) {
        console.error('Error searching YouTube:', error);
        await bot.sendMessage(chatId, '⚠️ Try again.');
    }
}

/**
 * 🎵 **Fetch YouTube Video Metadata**
 */
async function getYouTubeMetadata(videoId) {
    try {
        const metadataUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${youtubeApiKey}`;
        const response = await axios.get(metadataUrl);
        const video = response.data.items[0].snippet;

        return {
            title: video.title,
            artist: video.channelTitle,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` // ✅ High-Quality MQDefault
        };
    } catch (error) {
        console.error('Error fetching metadata:', error);
        return null;
    }
}

/**
 * 🔹 **Process Audio with Watermark & HQ Thumbnail**
 */
async function processAudioWithWatermark(audioUrl, coverUrl, title, artist, chatId) {
    const coverImagePath = 'cover.jpg';
    const watermarkAudioPath = 'watermark.mp3';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        // 📌 Download MQDefault Cover Image
        const coverImageResponse = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverImagePath, coverImageResponse.data);

        // 📌 Download Watermark Audio
        const watermarkAudioResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkAudioPath, watermarkAudioResponse.data);

        await bot.sendMessage(chatId, '⏳ Processing audio with MQDefault HQ poster...');

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(audioUrl) // ✅ Original Audio
                .input(watermarkAudioPath) // ✅ High-Quality Watermark
                .input(coverImagePath) // ✅ Original MQDefault Poster
                .complexFilter([
                    '[0]volume=1[a]',
                    '[1]adelay=10000|10000,volume=8.5[b]',
                    '[a][b]amix=inputs=2'
                ])
                .outputOptions([
                    '-metadata', `title=${title}`,
                    '-metadata', `artist=${artist}`,
                    '-map', '0:a', // ✅ Audio Track
                    '-map', '2:v', // ✅ MQDefault Image As Poster
                    '-c:v', 'mjpeg', // ✅ High-Quality Image Format
                    '-q:v', '1' // ✅ Lossless Image Quality
                ])
                .save(finalOutputName)
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
 * 🎧 **Fetch & Process YouTube Audio**
 */
async function fetchAndProcessAudio(chatId, videoId) {
    try {
        const metadata = await getYouTubeMetadata(videoId);
        if (!metadata) throw new Error('Metadata fetch failed');

        const audioJsonUrl = koyebApiJson + encodeURIComponent(`https://youtu.be/${videoId}`);
        const audioJsonResponse = await axios.get(audioJsonUrl);
        const audioUrl = audioJsonResponse.data.audio_url;

        if (!audioUrl) throw new Error('No audio URL found');

        const processedFilePath = await processAudioWithWatermark(audioUrl, metadata.thumbnail, metadata.title, metadata.artist, chatId);
        await bot.sendAudio(chatId, processedFilePath);

        setTimeout(() => {
            fs.unlinkSync(processedFilePath);
            console.log(`File ${processedFilePath} deleted.`);
        }, 60 * 1000);
    } catch (error) {
        console.error('Error fetching audio:', error);
        await bot.sendMessage(chatId, '❌ Error processing audio.');
    }
}

/**
 * 🛠 **Handle Messages**
 */
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const query = msg.text;

    if (query.startsWith('http')) {
        const videoId = extractVideoId(query);
        if (videoId) {
            await bot.sendMessage(chatId, '🔍 Fetching details...');
            await fetchAndProcessAudio(chatId, videoId);
        } else {
            await bot.sendMessage(chatId, '❌ Invalid YouTube URL.');
        }
    } else {
        await searchYouTube(query, chatId);
    }
});

/**
 * 🎥 **Extract YouTube Video ID**
 */
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|youtu.be\/|\/v\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
}

/**
 * 🖲 **Handle Callback Query**
 */
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const videoId = callbackQuery.data;

    await bot.sendMessage(chatId, '🔍 Fetching details...');
    await fetchAndProcessAudio(chatId, videoId);
});

/**
 * 🌍 **Express Server**
 */
app.get('/', (req, res) => {
    res.send('🤖 Bot is running...');
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
