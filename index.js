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
const youtubeApiKey = 'AIzaSyBX_-obwbQ3MZKeMTYS9x8SzjiXojl3nWs';

// API URLs
const koyebApiAudio = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play?url=';
const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

// Watermark URL
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

// Bot instance
const bot = new TelegramBot(botToken, { polling: true });

/**
 * **YouTube Video Search using YouTube Data API v3**
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
 * **Extract YouTube Video Metadata**
 */
async function getYouTubeMetadata(videoId) {
    try {
        const metadataUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${youtubeApiKey}`;
        const response = await axios.get(metadataUrl);
        const video = response.data.items[0].snippet;

        const thumbnails = video.thumbnails;
        const availableThumbnails = Object.keys(thumbnails).map((key) => ({
            quality: key,
            url: thumbnails[key].url,
            size: thumbnails[key].width * thumbnails[key].height / 1000 // size in KB
        }));

        return {
            title: video.title,
            artist: video.channelTitle,
            thumbnails: availableThumbnails
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
        const watermarkAudioResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkAudioPath, watermarkAudioResponse.data);

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
                    '-c:v', 'mjpeg',
                    '-vf', "drawtext=text='vivekfy':fontcolor=#000000:fontsize=40:box=1:boxcolor=#ffffff@0.9:x=(W-text_w)/2:y=H*0.8-text_h"
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
 * **Fetch and Process Audio**
 */
async function fetchAndProcessAudio(chatId, videoId) {
    try {
        const metadata = await getYouTubeMetadata(videoId);
        if (!metadata) throw new Error('Metadata fetch failed');

        const audioJsonUrl = koyebApiJson + encodeURIComponent(`https://youtu.be/${videoId}`);
        const audioJsonResponse = await axios.get(audioJsonUrl);
        const audioUrl = audioJsonResponse.data.audio_url;

        if (!audioUrl) throw new Error('No audio URL found');

        // Ask user to select thumbnail or automatically choose the largest one
        const options = metadata.thumbnails.map((thumbnail, index) => [{
            text: `Quality: ${thumbnail.quality} | Size: ${thumbnail.size}KB`,
            callback_data: `thumbnail_${index}`
        }]);

        const thumbnailMessage = await bot.sendMessage(chatId, 'Choose a thumbnail quality:', {
            reply_markup: { inline_keyboard: options }
        });

        const thumbnailTimeout = setTimeout(async () => {
            const largestThumbnail = metadata.thumbnails.reduce((prev, curr) => (curr.size > prev.size ? curr : prev));
            await bot.sendMessage(chatId, `No selection made. Using the largest thumbnail: Quality: ${largestThumbnail.quality}`);
            await processAndSendAudio(chatId, audioUrl, largestThumbnail.url, metadata.title, metadata.artist);
        }, 4000);

        bot.on('callback_query', async (callbackQuery) => {
            if (callbackQuery.message.message_id === thumbnailMessage.message_id) {
                const selectedIndex = parseInt(callbackQuery.data.split('_')[1]);
                const selectedThumbnail = metadata.thumbnails[selectedIndex];
                clearTimeout(thumbnailTimeout);
                await bot.sendMessage(chatId, `You selected: Quality: ${selectedThumbnail.quality}`);
                await processAndSendAudio(chatId, audioUrl, selectedThumbnail.url, metadata.title, metadata.artist);
            }
        });
    } catch (error) {
        console.error('Error fetching audio:', error);
        await bot.sendMessage(chatId, '❌ Error processing audio.');
    }
}

async function processAndSendAudio(chatId, audioUrl, thumbnailUrl, title, artist) {
    try {
        const processedFilePath = await processAudioWithWatermark(audioUrl, thumbnailUrl, title, artist, chatId);
        await bot.sendAudio(chatId, processedFilePath);

        setTimeout(() => {
            fs.unlinkSync(processedFilePath);
            console.log(`File ${processedFilePath} deleted.`);
        }, 60 * 1000);
    } catch (error) {
        console.error('Error during audio processing and sending:', error);
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
 * **Extract Video ID from URL**
 */
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|youtu.be\/|\/v\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
}

/**
 * **Handle Callback Query**
 */
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const videoId = callbackQuery.data;

    await bot.sendMessage(chatId, '🔍 Fetching details...');
    await fetchAndProcessAudio(chatId, videoId);
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

/**
 * **Keep Alive Request for Multiple URLs**
 */
const keepAliveUrls = [
    'https://vivekfy-meta-bot-1.onrender.com',
    'https://vivekfy-v2.onrender.com'
];

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
