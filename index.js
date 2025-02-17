const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 🔹 Bot Token
const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';
const youtubeApiKey = 'AIzaSyBX_-obwbQ3MZKeMTYS9x8SzjiXojl3nWs';
// 🔹 API URLs
const koyebApiJson = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';

// 🔹 Watermark URL & Text
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';
const watermarkText = 'Vivekfy AI';

// 🔹 Bot Instance
const bot = new TelegramBot(botToken, { polling: true });

/**
 * **YouTube Thumbnails Fetch & Best Selection**
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
 * **Fetch YouTube Video Metadata**
 */
async function getYouTubeMetadata(videoId) {
    try {
        const metadataUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${youtubeApiKey}`;
        const response = await axios.get(metadataUrl);
        const video = response.data.items[0].snippet;

        return {
            title: video.title,
            artist: video.channelTitle
        };
    } catch (error) {
        console.error('Error fetching metadata:', error);
        return null;
    }
}

/**
 * **Process Audio with Watermark & Thumbnail**
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
                    '-vf', `drawtext=text='${watermarkText}':fontcolor=#000000:fontsize=40:box=1:boxcolor=#ffffff@0.9:x=(W-text_w)/2:y=H*0.8-text_h`
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
 * **Fetch & Process Audio**
 */
async function fetchAndProcessAudio(chatId, videoId) {
    try {
        const metadata = await getYouTubeMetadata(videoId);
        if (!metadata) throw new Error('Metadata fetch failed');

        const bestThumbnail = await getBestThumbnail(videoId);
        if (!bestThumbnail.url) throw new Error('No valid thumbnail found');

        const audioJsonUrl = koyebApiJson + encodeURIComponent(`https://youtu.be/${videoId}`);
        const audioJsonResponse = await axios.get(audioJsonUrl);
        const audioUrl = audioJsonResponse.data.audio_url;
        const audioSize = parseInt(audioJsonResponse.headers['content-length'] || '0', 10) / (1024 * 1024);

        if (!audioUrl) throw new Error('No audio URL found');

        await bot.sendMessage(chatId, `🎵 **Title:** ${metadata.title}\n🎤 **Artist:** ${metadata.artist}\n📂 **Audio Size:** ${audioSize.toFixed(2)} MB\n🖼 **Poster Size:** ${(bestThumbnail.size / (1024 * 1024)).toFixed(2)} MB\n⏳ **Processing...**`);

        const processedFilePath = await processAudioWithWatermark(audioUrl, bestThumbnail.url, metadata.title, metadata.artist, chatId);
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
        await bot.sendMessage(chatId, '❌ Please provide a YouTube link.');
    }
});

/**
 * **Keep Alive**
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
