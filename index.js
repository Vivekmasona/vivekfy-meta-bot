const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = process.env.PORT || 3000;

// Bot & API Configurations
const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';
const youtubeApiKey = 'AIzaSyBfsNcJJHd-O0ftUzH2KqIRc_KhXgPXne0';
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

// Audio Fetching URLs
const audioJsonApi = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/json?url=';
const audioDirectApi = 'https://thirsty-editha-vivekfy-6cef7b64.koyeb.app/play?url=';

// Start Telegram Bot
const bot = new TelegramBot(botToken, { polling: true });

// Function to get video metadata from YouTube API
async function fetchYouTubeMetadata(videoId) {
    try {
        const url = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${youtubeApiKey}&part=snippet`;
        const response = await axios.get(url);
        const video = response.data.items[0];

        return {
            title: video.snippet.title,
            artist: video.snippet.channelTitle,
            thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
        };
    } catch (error) {
        console.error('Error fetching YouTube metadata:', error);
        return null;
    }
}

// Function to process audio and add watermark
async function processAudioWithWatermark(audioUrl, thumbnail, title, artist, chatId) {
    const watermarkPath = 'watermark.mp3';
    const coverPath = 'cover.jpg';
    const outputFile = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        const watermarkRes = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkPath, watermarkRes.data);

        const coverRes = await axios.get(thumbnail, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverPath, coverRes.data);

        await bot.sendMessage(chatId, 'Processing audio...');

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(audioUrl)
                .input(watermarkPath)
                .input(coverPath)
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
                .save(outputFile)
                .on('end', () => {
                    fs.unlinkSync(coverPath);
                    fs.unlinkSync(watermarkPath);
                    resolve(outputFile);
                })
                .on('error', reject);
        });
    } catch (error) {
        console.error('Error processing audio:', error);
        throw new Error('Failed to process audio.');
    }
}

// Function to fetch and process audio
async function fetchAudio(chatId, youtubeUrl, title, artist, thumbnail) {
    try {
        const response = await axios.get(audioJsonApi + encodeURIComponent(youtubeUrl));
        const audioUrl = response.data.audio_url;

        if (!audioUrl) throw new Error('Audio URL not found in JSON response.');

        const filePath = await processAudioWithWatermark(audioUrl, thumbnail, title, artist, chatId);

        await bot.sendMessage(chatId, 'Processing complete! Sending audio...');

        await bot.sendAudio(chatId, filePath).then(async (audioMessage) => {
            const fileId = audioMessage.audio.file_id;
            const fileInfo = await bot.getFile(fileId);
            const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

            const options = {
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Download', url: downloadUrl }
                    ]]
                }
            };

            await bot.sendMessage(chatId, 'Download audio:', options);

            setTimeout(() => {
                fs.unlinkSync(filePath);
                console.log(`File ${filePath} deleted.`);
            }, 60000);
        });

    } catch (error) {
        console.error('Error fetching or processing audio:', error);
        await bot.sendMessage(chatId, 'Failed to process audio.');
    }
}

// YouTube Search using v3 API
async function searchYouTube(query, chatId) {
    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&key=${youtubeApiKey}&maxResults=5&type=video`;
        const response = await axios.get(url);
        const videos = response.data.items;

        if (videos.length > 0) {
            const options = {
                reply_markup: {
                    inline_keyboard: videos.map(video => ([
                        { text: video.snippet.title, callback_data: video.id.videoId }
                    ]))
                }
            };
            bot.sendMessage(chatId, 'Search results:', options);
        } else {
            bot.sendMessage(chatId, 'No results found.');
        }
    } catch (error) {
        console.error('Error searching YouTube:', error);
        bot.sendMessage(chatId, 'Error while searching.');
    }
}

// Handle messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const query = msg.text;

    if (query.startsWith('http')) {
        const videoId = extractVideoId(query);
        if (videoId) {
            const metadata = await fetchYouTubeMetadata(videoId);
            if (metadata) {
                await fetchAudio(chatId, query, metadata.title, metadata.artist, metadata.thumbnail);
            } else {
                bot.sendMessage(chatId, 'Could not fetch video details.');
            }
        } else {
            bot.sendMessage(chatId, 'Invalid YouTube URL.');
        }
    } else {
        await searchYouTube(query, chatId);
    }
});

// Extract YouTube Video ID
function extractVideoId(url) {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/|.*=|.*\?v=|.*&v=))([\w-]{11})/);
    return match ? match[1] : null;
}

// Handle callback queries
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const videoId = callbackQuery.data;

    const metadata = await fetchYouTubeMetadata(videoId);
    if (metadata) {
        const youtubeUrl = `https://youtu.be/${videoId}`;
        await fetchAudio(chatId, youtubeUrl, metadata.title, metadata.artist, metadata.thumbnail);
    } else {
        bot.sendMessage(chatId, 'Error fetching video details.');
    }
});

// Express server to keep bot alive
app.get('/', (req, res) => res.send('Bot is running'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
