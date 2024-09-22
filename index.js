const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token
const botToken = '7426827982:AAFNLzurDSYX8rEmdI-JxCRyKoZMtszTL7I';

// Create Telegram bot instance
const bot = new TelegramBot(botToken, { polling: true });

// Function to process audio and add metadata with text overlay
async function processAudioWithMetadata(apiUrl, coverUrl, title, artist, chatId) {
    const coverImagePath = 'cover.jpg';
    const finalOutputName = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_with_metadata.mp3`;

    try {
        const coverImageResponse = await axios.get(coverUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(coverImagePath, coverImageResponse.data);

        // Inform user that audio processing has started
        await bot.sendMessage(chatId, 'Processing audio... Please wait while we process your file.');

        return new Promise((resolve, reject) => {
            let progressMessageId = null;
            let lastReportedProgress = 0;

            ffmpeg()
                .input(apiUrl)
                .audioBitrate(48)
                .input(coverImagePath)
                .outputOptions([
                    '-metadata', `title=${title}`,
                    '-metadata', `artist=${artist}`,
                    '-map', '0:a',
                    '-map', '1:v',
                    '-c:v', 'mjpeg',
                    '-vf', "drawtext=text='Download from vivekfy':fontcolor=black:fontsize=24:x=(W-text_w)/2:y=(H-text_h)/2"
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
                    resolve(finalOutputName);
                })
                .on('error', (err) => {
                    console.error('Error adding metadata: ', err);
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
        `https://vivekfy.vercel.app/vivekfy?url=${encodeURIComponent(youtubeUrl)}`,
        `https://vivekfy.vercel.app/vivekfy2?url=${encodeURIComponent(youtubeUrl)}`
    ];

    for (const apiUrl of apiUrls) {
        try {
            return await processAudioWithMetadata(apiUrl, thumbnail, title, artist, chatId);
        } catch (error) {
            console.error(`Failed to fetch audio from ${apiUrl}: ${error.message}`);
            // Continue to the next API
        }
    }

    throw new Error('Both APIs failed to fetch audio.');
}

// Handler for text messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const youtubeUrl = msg.text;

    // Check if the message is a YouTube URL
    const videoId = extractVideoId(youtubeUrl);
    if (videoId) {
        const metadataApiUrl = `https://vivekfy.vercel.app/vid?id=${videoId}`;
        try {
            await bot.sendMessage(chatId, 'Fetching metadata...');

            // Fetch metadata
            const metadataResponse = await axios.get(metadataApiUrl);
            const { title, artist, thumbnail } = metadataResponse.data;

            // Fetch audio and add metadata with progress reporting
            const filePath = await fetchAudio(chatId, youtubeUrl, title, artist, thumbnail);

            // Send the processed file to the user
            await bot.sendMessage(chatId, 'Processing completed! Sending the processed audio file...');
            await bot.sendAudio(chatId, filePath).then(() => {
                fs.unlinkSync(filePath); // Clean up after sending the file
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

// Start Express server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});