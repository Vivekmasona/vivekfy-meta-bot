const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Bot Token
const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';
const youtubeApiKey = 'AIzaSyBX_-obwbQ3MZKeMTYS9x8SzjiXojl3nWs';

// 🔹 API URLs
const koyebApiAudio = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play?url=';
const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

// 🔹 Watermark Text
const watermarkText = 'vivekfy ai';

// 📌 Initialize Telegram Bot
const bot = new TelegramBot(botToken, { polling: true });

/**
 * 🖼 **Fetch YouTube Thumbnails & Select Best**
 */
async function getBestThumbnail(videoId) {
    const sizes = ["maxresdefault", "hqdefault", "mqdefault", "sddefault", "default"];
    let bestThumbnail = null;
    let maxSize = 0;

    for (const size of sizes) {
        const url = `https://i.ytimg.com/vi/${videoId}/${size}.jpg`;
        try {
            const response = await axios.head(url);
            const fileSize = parseInt(response.headers['content-length'] || 0);

            if (fileSize > maxSize) {
                maxSize = fileSize;
                bestThumbnail = url;
            }
        } catch (error) {
            console.warn(`Thumbnail not available: ${url}`);
        }
    }

    return bestThumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * 🎵 **Fetch YouTube Video Metadata**
 */
async function getYouTubeMetadata(videoId) {
    try {
        const metadataUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${youtubeApiKey}`;
        const response = await axios.get(metadataUrl);
        const video = response.data.items[0].snippet;

        // ✅ Best Thumbnail Selection
        const bestThumbnail = await getBestThumbnail(videoId);

        return {
            title: video.title,
            artist: video.channelTitle,
            thumbnail: bestThumbnail
        };
    } catch (error) {
        console.error('Error fetching metadata:', error);
        return null;
    }
}

/**
 * 🔹 **Process Audio with Watermark & Best Thumbnail**
 */
async function processAudioWithWatermark(audioUrl, coverUrl, title, artist, chatId) {
    const coverImagePath = 'cover.jpg';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        // 📌 Download Best Thumbnail
        const coverImageResponse = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverImagePath, coverImageResponse.data);

        await bot.sendMessage(chatId, '⏳ Processing audio with best quality poster...');

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(audioUrl) // ✅ Original Audio
                .input(coverImagePath) // ✅ Best Quality Thumbnail
                .complexFilter([
                    `[0:a]volume=1[a]`,
                    `[a]asetpts=PTS-STARTPTS, drawtext=text='${watermarkText}':x=(w-tw)/2:y=(h-th-10):fontsize=30:fontcolor=white`
                ])
                .outputOptions([
                    '-metadata', `title=${title}`,
                    '-metadata', `artist=${artist}`,
                    '-map', '0:a', // ✅ Audio Track
                    '-map', '1:v', // ✅ Best Quality Image As Poster
                    '-c:v', 'mjpeg', // ✅ High-Quality Image Format
                    '-q:v', '1' // ✅ Lossless Image Quality
                ])
                .save(finalOutputName)
                .on('end', async () => {
                    fs.unlinkSync(coverImagePath);
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
        await bot.sendMessage(chatId, '⚡ Send a valid YouTube URL.');
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
 * 🌍 **Express Server**
 */
app.get('/', (req, res) => {
    res.send('🤖 Bot is running...');
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
