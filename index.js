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
const youtubeApiKey = 'AIzaSyBfsNcJJHd-O0ftUzH2KqIRc_KhXgPXne0';

// API URLs
const koyebApiAudio = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play?url=';
const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

// Watermark URL
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

// Keep-Alive URL
const keepAliveUrl = 'https://vivekfy-meta-bot-1.onrender.com';

// Create Telegram bot instance
const bot = new TelegramBot(botToken, { polling: true });

// Function to keep the project awake
function keepAlive() {
    setInterval(async () => {
        try {
            await axios.get(keepAliveUrl);
            console.log('Pinged Keep-Alive URL to keep the project awake.');
        } catch (error) {
            console.error('Error pinging Keep-Alive URL:', error);
        }
    }, 240000); // 4 minutes
}

// Start keep-alive process
keepAlive();

/**
 * **YouTube Video Search using YouTube Data API v3**
 */
async function searchYouTube(query, chatId) {
    try {
        console.log(`Searching YouTube for: ${query}`);
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(query)}&key=${youtubeApiKey}`;
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
 * **Extract YouTube Video Metadata**
 */
async function getYouTubeMetadata(videoId) {
    try {
        console.log(`Fetching metadata for videoId: ${videoId}`);
        const metadataUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${youtubeApiKey}`;
        const response = await axios.get(metadataUrl);
        const video = response.data.items[0].snippet;

        return {
            title: video.title,
            artist: video.channelTitle,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
        };
    } catch (error) {
        console.error('Error fetching metadata:', error);
        return null;
    }
}

/**
 * **Process Audio with Watermark**
 */
async function processAudioWithWatermark(audioUrl, coverUrl, title, artist, chatId) {
    const coverImagePath = 'cover.jpg';
    const watermarkAudioPath = 'watermark.mp3';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        console.log('Downloading watermark audio...');
        const watermarkAudioResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkAudioPath, watermarkAudioResponse.data);

        console.log('Downloading cover image...');
        const coverImageResponse = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverImagePath, coverImageResponse.data);

        await bot.sendMessage(chatId, '⏳ Processing audio...');

        return new Promise((resolve, reject) => {
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
                    '-c:v', 'mjpeg'
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
        console.error('Error processing audio:', error);
        throw new Error('Error processing audio.');
    }
}

/**
 * **Fetch and Process Audio**
 */
async function fetchAndProcessAudio(chatId, videoId) {
    try {
        console.log(`Fetching audio for videoId: ${videoId}`);
        const metadata = await getYouTubeMetadata(videoId);
        if (!metadata) throw new Error('Metadata fetch failed');

        console.log(`Fetching audio URL from: ${koyebApiJson + encodeURIComponent(`https://youtu.be/${videoId}`)}`);
        const audioJsonResponse = await axios.get(koyebApiJson + encodeURIComponent(`https://youtu.be/${videoId}`));
        console.log(`Audio JSON Response:`, audioJsonResponse.data);

        const audioUrl = audioJsonResponse.data.audio_url;
        if (!audioUrl) throw new Error('No audio URL found');

        console.log(`Processing audio with watermark for: ${audioUrl}`);
        const processedFilePath = await processAudioWithWatermark(audioUrl, metadata.thumbnail, metadata.title, metadata.artist, chatId);
        console.log(`Processed audio file path: ${processedFilePath}`);

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
 * **Handle Messages**
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
 * **Express Server (Keep Bot Alive)**
 */
app.get('/', (req, res) => {
    res.send('🤖 Bot is running...');
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
