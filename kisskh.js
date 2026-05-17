const cheerio = require('cheerio-without-node-native');

const MAIN_URL = "https://kisskh.ovh";

const KISSKH_API =
    "https://script.google.com/macros/s/AKfycbzn8B31PuDxzaMa9_CQ0VGEDasFqfzI5bXvjaIZH4DM8DNq9q6xj1ALvZNz_JT3jF0suA/exec?id=";

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {

    return new Promise((resolve) => {

        const tmdbUrl =
            `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=b030404650f279792a8d3287232358e3`;

        fetch(tmdbUrl)

            .then(res => res.json())

            .then(tmdbData => {

                const title =
                    tmdbData.title ||
                    tmdbData.name ||
                    tmdbData.original_title;

                const searchUrl =
                    `${MAIN_URL}/api/DramaList/Search?q=${encodeURIComponent(title)}&type=0`;

                return fetch(searchUrl)
                    .then(res => res.json())
                    .then(searchList => {

                        let matched =
                            searchList.find(
                                item =>
                                    item.title &&
                                    item.title.toLowerCase() === title.toLowerCase()
                            );

                        // fallback first result
                        if (!matched && searchList.length > 0) {
                            matched = searchList[0];
                        }

                        if (!matched) {
                            throw new Error("Drama not found");
                        }

                        return matched.id;
                    });
            })

            // Get drama details
            .then(dramaId => {

                return fetch(
                    `${MAIN_URL}/api/DramaList/Drama/${dramaId}?isq=false`
                )
                    .then(res => res.json())
                    .then(detail => {

                        const episodes = detail.episodes;

                        if (!episodes || episodes.length === 0) {
                            throw new Error("No episodes found");
                        }

                        let targetEp;

                        // Movie
                        if (mediaType === "movie") {

                            targetEp =
                                episodes[episodes.length - 1];

                        }

                        // TV
                        else {

                            targetEp = episodes.find(
                                ep =>
                                    parseInt(ep.number) === parseInt(episodeNum)
                            );
                        }

                        if (!targetEp) {
                            throw new Error(
                                `Episode ${episodeNum} not found`
                            );
                        }

                        return targetEp.id;
                    });
            })

            // Get stream key
            .then(epsId => {

                const keyUrl =
                    `${KISSKH_API}${epsId}&version=2.8.10`;

                return fetch(keyUrl)

                    .then(res => res.json())

                    .then(keyData => {

                        if (!keyData.key) {
                            throw new Error("Failed to get video key");
                        }

                        const videoApi =
                            `${MAIN_URL}/api/DramaList/Episode/${epsId}.png?err=false&ts=&time=&kkey=${keyData.key}`;

                        return fetch(videoApi);
                    });
            })

            // Process stream data
            .then(res => res.json())

            .then(sources => {

                console.log(
                    "KISSKH FULL RESPONSE:",
                    JSON.stringify(sources, null, 2)
                );

                const streams = [];

                // =========================
                // SUBTITLE EXTRACTION
                // =========================
                const captions = [];

                const subtitleSources =
                    sources.subtitles ||
                    sources.Subtitles ||
                    sources.tracks ||
                    sources.Tracks ||
                    sources.captions ||
                    sources.Captions ||
                    [];

                console.log(
                    "SUBTITLE DATA:",
                    JSON.stringify(subtitleSources, null, 2)
                );

                subtitleSources.forEach(sub => {

                    const subUrl =
                        sub.src ||
                        sub.file ||
                        sub.url;

                    if (!subUrl) return;

                    captions.push({
                        url: subUrl,
                        language:
                            sub.label ||
                            sub.lang ||
                            sub.language ||
                            "English"
                    });
                });

                // =========================
                // VIDEO LINKS
                // =========================
                const links = [
                    sources.Video,
                    sources.ThirdParty
                ].filter(Boolean);

                links.forEach(link => {

                    // HLS
                    if (link.includes(".m3u8")) {

                        streams.push({
                            name: "Kisskh HLS",
                            title: "Kisskh Stream",
                            url: link,
                            quality: "Auto",

                            headers: {
                                "Origin": MAIN_URL,
                                "Referer": MAIN_URL
                            },

                            captions: captions,

                            provider: "kisskh"
                        });
                    }

                    // MP4
                    else if (link.includes(".mp4")) {

                        streams.push({
                            name: "Kisskh MP4",
                            title: "Kisskh Stream",
                            url: link,
                            quality: "Auto",

                            headers: {
                                "Referer": MAIN_URL
                            },

                            captions: captions,

                            provider: "kisskh"
                        });
                    }
                });

                console.log(
                    "FINAL STREAMS:",
                    JSON.stringify(streams, null, 2)
                );

                resolve(streams);
            })

            .catch(err => {

                console.error("Kisskh Error:", err);

                resolve([]);
            });
    });
}

if (typeof module !== 'undefined' && module.exports) {

    module.exports = { getStreams };

} else {

    global.getStreams = getStreams;
}