const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token
const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';
const watermarkUrl = 'https://github.com/Vivekmasona/dav12/raw/refs/heads/main/watermark.mp3';

// Create Telegram bot instance
const bot = new TelegramBot(botToken, { polling: true });

// Function to process audio and add watermark after 10 seconds
async function processAudioWithWatermark(apiUrl, coverUrl, title, artist, chatId) {
    const coverImagePath = 'cover.jpg';
    const watermarkAudioPath = 'watermark.mp3';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    try {
        // Step 1: Download the watermark audio file
        const watermarkAudioResponse = await axios.get(watermarkUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(watermarkAudioPath, watermarkAudioResponse.data);

        // Step 2: Download the cover image
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
                    '-vf', "drawtext=text='Download from vivekfy':fontcolor=white:fontsize=24:box=1:boxcolor=black@0.9:x=(W-text_w)/2:y=(H-text_h)/2"
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
                    // Clean up temporary files
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

// Helper function to fetch audio from both APIs
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

// Handler for text messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const youtubeUrl = msg.text;

    const videoId = extractVideoId(youtubeUrl);
    if (videoId) {
        const metadataApiUrl = `https://vivekfy.vercel.app/vid?id=${videoId}`;
        try {
            await bot.sendMessage(chatId, 'Fetching metadata...');

            const metadataResponse = await axios.get(metadataApiUrl);
            const { title, artist, thumbnail } = metadataResponse.data;

            const filePath = await fetchAudio(chatId, youtubeUrl, title, artist, thumbnail);

            await bot.sendMessage(chatId, 'Processing completed! Sending the processed audio file...');

            await bot.sendAudio(chatId, filePath).then(async (audioMessage) => {
                const fileId = audioMessage.audio.file_id;

                const fileInfo = await bot.getFile(fileId);
                const directDownloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

                // Create a download link with title
                const downloadUrl = `${directDownloadUrl}?title=${encodeURIComponent(title)}.mp3`;

                const options = {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: 'Download', url: downloadUrl }
                        ]]
                    }
                };

                await bot.sendMessage(chatId, 'You can download the audio directly from the button below:', options);

                // Set a timer to delete the file after one minute
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
});

// Utility function to extract video ID from YouTube URL
function extractVideoId(url) {
    const regex = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
    const match = url.match(regex);
    return match ? match[1] : null;
}

// Self-ping to prevent Glitch from sleeping
const glitchProjectUrl = 'https://marbled-tasteful-schooner.glitch.me/';
const keepGlitchActive = () => {
    axios.get(glitchProjectUrl)
        .then(response => {
            console.log('Pinged Glitch project to keep it active.');
        })
        .catch(error => {
            console.error('Error pinging Glitch project:', error);
        });
};

// Ping the Glitch project URL every 5 minutes
setInterval(keepGlitchActive, 300000);

// Start Express server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
