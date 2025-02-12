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

// Multiple Audio API URLs (jitne chaho add kar sakte ho)
const audioApis = [
    'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=',
    'https://vivekfy.vercel.app/json?url=',
];

// Watermark URL
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

// Bot instance
const bot = new TelegramBot(botToken, { polling: true });

/**
 * **YouTube Video Metadata Fetch**
 */
async function getYouTubeMetadata(videoId) {
    try {
        const metadataUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${youtubeApiKey}`;
        const response = await axios.get(metadataUrl);
        const video = response.data.items[0].snippet;

        return {
            title: `${video.title} - Vivekfy`,
            artist: `${video.channelTitle} + vfy.ai`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
        };
    } catch (error) {
        console.error('Error fetching metadata:', error);
        return null;
    }
}

/**
 * **Fetch Audio URL from Multiple APIs**
 */
async function getAudioUrl(videoId) {
    for (let i = 0; i < audioApis.length; i++) {
        try {
            const audioJsonUrl = audioApis[i] + encodeURIComponent(`https://youtu.be/${videoId}`);
            const response = await axios.get(audioJsonUrl);
            if (response.data.audio_url) {
                return { url: response.data.audio_url, apiNumber: i + 1 };
            }
        } catch (error) {
            console.error(`API #${i + 1} failed:`, error.message);
        }
    }
    return null;
}

/**
 * **Process Audio with Watermark**
 */
async function processAudioWithWatermark(audioUrl, coverUrl, title, artist, chatId, apiNumber) {
    const coverImagePath = 'cover.jpg';
    const watermarkAudioPath = 'watermark.mp3';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        const watermarkAudioResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkAudioPath, watermarkAudioResponse.data);

        const coverImageResponse = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverImagePath, coverImageResponse.data);

        await bot.sendMessage(chatId, `⏳ Processing audio from API #${apiNumber}...`);

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
                    '-vf', "drawtext=text='Download from vivekfy':fontcolor=#000000:fontsize=34:box=1:boxcolor=#ffffff@0.6:x=(W-text_w)/2:y=H*0.8-text_h"
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

        const audioData = await getAudioUrl(videoId);
        if (!audioData) throw new Error('No audio URL found from any API');

        const processedFilePath = await processAudioWithWatermark(audioData.url, metadata.thumbnail, metadata.title, metadata.artist, chatId, audioData.apiNumber);
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
        await bot.sendMessage(chatId, '❌ Please enter a valid YouTube URL.');
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
 * **Express Server (Keep Bot Alive)**
 */
app.get('/', (req, res) => {
    res.send('🤖 Bot is running...');
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
