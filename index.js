const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token
const botToken = '426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';
const apiUrl = 'https://inv.nadeko.net/api/v1/search?q=';
const keepAliveUrl = 'https://scratch-slash-saguaro.glitch.me/';

// Create Telegram bot instance
const bot = new TelegramBot(botToken, { polling: true });

// Function to keep the project awake
function keepAlive() {
    setInterval(async () => {
        try {
            await axios.get(keepAliveUrl);
            console.log('Pinged Glitch URL to keep the project awake.');
        } catch (error) {
            console.error('Error pinging Glitch URL:', error);
        }
    }, 240000); // 4 minutes in milliseconds
}

// Start keeping the project awake
keepAlive();

// Function to process audio and add watermark after 10 seconds
async function processAudioWithWatermark(apiUrl, coverUrl, title, artist, chatId) {
    const coverImagePath = 'cover.jpg';
    const watermarkAudioPath = 'watermark.mp3';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        const watermarkAudioResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkAudioPath, watermarkAudioResponse.data);

        const coverImageResponse = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverImagePath, coverImageResponse.data);

        await bot.sendMessage(chatId, 'Processing audio... Please wait while we process your file.');

        return new Promise((resolve, reject) => {
            let progressMessageId = null;
            let lastReportedProgress = 0;

            ffmpeg()
                .input(apiUrl)
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
                    '-vf', "drawtext=text='Download from vivekfy':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.9:x=(W-text_w)/2:y=H*0.4-text_h"
                ])
                .save(finalOutputName)
                .on('progress', async (progress) => {
                    const percent = Math.round(progress.percent || 0);
                    if (percent > lastReportedProgress + 5) {
                        lastReportedProgress = percent;
                        if (!progressMessageId) {
                            const progressMessage = await bot.sendMessage(chatId, `Progress: ${percent}%`);
                            progressMessageId = progressMessage.message_id;
                        } else {
                            await bot.editMessageText(`Progress: ${percent}%`, { chat_id: chatId, message_id: progressMessageId });
                        }
                    }
                })
                .on('end', async () => {
                    fs.unlinkSync(coverImagePath);
                    fs.unlinkSync(watermarkAudioPath);
                    resolve(finalOutputName);
                })
                .on('error', (err) => {
                    console.error('Error adding watermark: ', err);
                    reject(err);
                });
        });
    } catch (error) {
        console.error('Error:', error);
        throw new Error('An error occurred while processing audio.');
    }
}

// Helper function to fetch audio from APIs
async function fetchAudio(chatId, youtubeUrl, title, artist, thumbnail) {
    const apiUrls = [
        `https://vivekfy.vercel.app/stream?url=${encodeURIComponent(youtubeUrl)}`,
        `https://vivekfy.vercel.app/vivekfy?url=${encodeURIComponent(youtubeUrl)}`,
        `https://vivekfy.vercel.app/vivekfy2?url=${encodeURIComponent(youtubeUrl)}`
    ];

    for (const apiUrl of apiUrls) {
        try {
            const apiName = apiUrl.includes('stream') ? 'stream' : (apiUrl.includes('vivekfy') ? 'Vivekfy' : 'Vivekfy2');
            await bot.sendMessage(chatId, `Using API: ${apiName}`);
            return await processAudioWithWatermark(apiUrl, thumbnail, title, artist, chatId);
        } catch (error) {
            console.error(`Failed to fetch audio from ${apiUrl}: ${error.message}`);
        }
    }

    throw new Error('Both APIs failed to fetch audio.');
}

// Function to search for songs using Invidious API
async function searchSongs(query, chatId) {
    try {
        const response = await axios.get(apiUrl + encodeURIComponent(query));
        const videos = response.data;

        if (videos.length > 0) {
            videos.forEach(video => {
                const options = {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: video.title, callback_data: video.videoId }
                        ]]
                    }
                };
                bot.sendMessage(chatId, 'Search results:', options);
            });
        } else {
            bot.sendMessage(chatId, 'No results found.');
        }
    } catch (error) {
        console.error('Error fetching videos:', error);
        bot.sendMessage(chatId, 'Failed to load videos. Please try again.');
    }
}

// Handler for text messages (URLs or song titles)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const query = msg.text;

    // Check if the user sent a URL (YouTube link)
    if (query.startsWith('http')) {
        const videoId = extractVideoId(query);  // Add a helper function for extracting video ID
        if (videoId) {
            const metadataApiUrl = `https://vivekfy.vercel.app/vid?id=${videoId}`;
            try {
                await bot.sendMessage(chatId, 'Fetching metadata...');

                const metadataResponse = await axios.get(metadataApiUrl);
                const { title, artist, thumbnail } = metadataResponse.data;

                const filePath = await fetchAudio(chatId, query, title, artist, thumbnail);

                await bot.sendMessage(chatId, 'Processing completed! Sending the processed audio file...');

                await bot.sendAudio(chatId, filePath).then(async (audioMessage) => {
                    const fileId = audioMessage.audio.file_id;
                    const fileInfo = await bot.getFile(fileId);
                    const directDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

                    const downloadUrl = `${directDownloadUrl}?title=${encodeURIComponent(title)}.mp3`;

                    const options = {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: 'Download', url: downloadUrl }
                            ]]
                        }
                    };

                    await bot.sendMessage(chatId, 'You can download the audio directly from the button below:', options);

                    setTimeout(() => {
                        fs.unlinkSync(filePath);
                        console.log(`File ${filePath} deleted after 1 minute.`);
                    }, 60 * 1000);
                });

            } catch (error) {
                console.error('Error fetching metadata or processing audio: ', error);
                await bot.sendMessage(chatId, 'Error processing the audio.');
            }
        } else {
            await bot.sendMessage(chatId, 'Please send a valid YouTube URL.');
        }
    } else {
        await searchSongs(query, chatId);  // Handle regular song search
    }
});

// Function to extract video ID from a YouTube URL
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|youtu.be\/|\/v\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
}

// Handle callback queries for song selection
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const videoId = callbackQuery.data;

    // Handle selection (fetch audio based on videoId)
    const metadataApiUrl = `https://vivekfy.vercel.app/vid?id=${videoId}`;
    try {
        await bot.sendMessage(chatId, 'Fetching metadata...');

        const metadataResponse = await axios.get(metadataApiUrl);
        const { title, artist, thumbnail } = metadataResponse.data;

        const youtubeUrl = `https://youtu.be/${videoId}`;
        const filePath = await fetchAudio(chatId, youtubeUrl, title, artist, thumbnail);

        await bot.sendMessage(chatId, 'Processing completed! Sending the processed audio file...');

        await bot.sendAudio(chatId, filePath).then(async (audioMessage) => {
            const fileId = audioMessage.audio.file_id;
            const fileInfo = await bot.getFile(fileId);
            const directDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

            const downloadUrl = `${directDownloadUrl}?title=${encodeURIComponent(title)}.mp3`;

            const options = {
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Download', url: downloadUrl }
                    ]]
                }
            };

            await bot.sendMessage(chatId, 'You can download the audio directly from the button below:', options);

            setTimeout(() => {
                fs.unlinkSync(filePath);
                console.log(`File ${filePath} deleted after 1 minute.`);
            }, 60 * 1000);
        });

    } catch (error) {
        console.error('Error fetching metadata or processing audio: ', error);
        await bot.sendMessage(chatId, 'Error processing the audio.');
    }
});

// Start Express server to keep the bot alive
app.get('/', (req, res) => {
    res.send('Bot is running');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
