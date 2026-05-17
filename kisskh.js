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

                        if (!matched && searchList.length > 0) {
                            matched = searchList[0];
                        }

                        if (!matched) {
                            throw new Error("Drama not found");
                        }

                        return matched.id;
                    });
            })

            .then(dramaId => {

                return fetch(
                    `${MAIN_URL}/api/DramaList/Drama/${dramaId}?isq=false`
                )

                    .then(res => res.json())

                    .then(detail => {

                        const episodes = detail.episodes;

                        if (!episodes || episodes.length === 0) {
                            throw new Error("No episodes");
                        }

                        let targetEp;

                        if (mediaType === "movie") {

                            targetEp =
                                episodes[episodes.length - 1];

                        } else {

                            targetEp =
                                episodes.find(
                                    ep =>
                                        parseInt(ep.number) === parseInt(episodeNum)
                                );
                        }

                        if (!targetEp) {
                            throw new Error("Episode not found");
                        }

                        return targetEp.id;
                    });
            })

            .then(epsId => {

                const keyUrl =
                    `${KISSKH_API}${epsId}&version=2.8.10`;

                return fetch(keyUrl)

                    .then(res => res.json())

                    .then(keyData => {

                        if (!keyData.key) {
                            throw new Error("No key");
                        }

                        const videoApi =
                            `${MAIN_URL}/api/DramaList/Episode/${epsId}.png?err=false&ts=&time=&kkey=${keyData.key}`;

                        return fetch(videoApi);
                    });
            })

            .then(res => res.json())

            .then(sources => {

                console.log(
                    "FULL API RESPONSE:",
                    JSON.stringify(sources, null, 2)
                );

                const streams = [];

                // =========================
                // SUBTITLES
                // =========================
                const subtitles = [];

                const subtitleSources =
                    sources.subtitles ||
                    sources.Subtitles ||
                    sources.tracks ||
                    sources.Tracks ||
                    [];

                console.log(
                    "SUBTITLE SOURCES:",
                    JSON.stringify(subtitleSources, null, 2)
                );

                subtitleSources.forEach(sub => {

                    const subFile =
                        sub.src ||
                        sub.file ||
                        sub.url;

                    if (!subFile) return;

                    subtitles.push({
                        file: subFile,
                        label:
                            sub.label ||
                            sub.lang ||
                            sub.language ||
                            "English"
                    });
                });

                // =========================
                // STREAM LINKS
                // =========================
                const links = [
                    sources.Video,
                    sources.ThirdParty
                ].filter(Boolean);

                links.forEach(link => {

                    streams.push({

                        name: "Kisskh",
                        title: "Kisskh Stream",

                        url: link,

                        quality: "Auto",

                        headers: {
                            "Origin": MAIN_URL,
                            "Referer": MAIN_URL
                        },

                        subtitles: subtitles,

                        provider: "kisskh"
                    });
                });

                console.log(
                    "FINAL STREAMS:",
                    JSON.stringify(streams, null, 2)
                );

                resolve(streams);
            })

            .catch(err => {

                console.error(
                    "KISSKH ERROR:",
                    err
                );

                resolve([]);
            });
    });
}

if (typeof module !== 'undefined' && module.exports) {

    module.exports = { getStreams };

} else {

    global.getStreams = getStreams;
}