const axios = require('axios');

async function getStreams(to, id, type) {
    const baseUrl = "https://sub.shiscan.com";
    let streams = [];

    try {
        if (!id) return [];

        // 1. Search for the content ID
        let searchUrl = `${baseUrl}/v1/api/search?q=${encodeURIComponent(id)}`;
        let searchRes = await axios.get(searchUrl);
        let data = searchRes.data;

        if (!data || data.length === 0) return [];

        let detail = data[0];
        let idMovie = detail.id;

        // 2. Fetch the video and subtitle metadata
        let videoUrl = `${baseUrl}/v1/api/embed?id=${idMovie}`;
        let videoRes = await axios.get(videoUrl);
        let videoData = videoRes.data;

        // 3. Parse Subtitles if they exist in the API response
        let parsedSubtitles = [];
        if (videoData && videoData.subtitles && videoData.subtitles.length > 0) {
            parsedSubtitles = videoData.subtitles.map(sub => ({
                id: sub.id || sub.label,
                url: sub.src || sub.url,
                lang: sub.label || sub.lang || 'English'
            }));
        }

        // 4. Attach video streams and inject the parsed subtitles
        if (videoData && videoData.streams) {
            videoData.streams.forEach(stream => {
                streams.push({
                    name: `KissKh [${stream.label || 'Default'}]`,
                    url: stream.url,
                    quality: stream.label || 'Unknown',
                    type: 'm3u8',
                    subtitles: parsedSubtitles
                });
            });
        }

        return streams;
    } catch (error) {
        console.error("Error fetching KissKh streams with subtitles:", error.message);
        return [];
    }
}

module.exports = { getStreams };
