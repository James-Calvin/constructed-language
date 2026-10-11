(function (root) {
  "use strict";
  function create({ runtime, utils, audio = new root.Audio(), url = root.URL }) {
    const cache = new Map();
    let version = 0, disposed = false;
    function stop() { version++; audio.pause(); audio.currentTime = 0; }
    async function play(word, ipa) {
      stop();
      const current = version, config = runtime.awsConfig;
      if (!runtime.isPlaybackConfigured || !await runtime.ensureAwsCredentials()) throw new Error("Pronunciation playback is unavailable.");
      if (current !== version || disposed) return false;
      const key = JSON.stringify([word, ipa, config.region, config.voiceId, config.engine, config.outputFormat]);
      let source = cache.get(key);
      if (!source) {
        const client = runtime.getPollyClient();
        if (!client) throw new Error("Pronunciation playback is unavailable.");
        const data = await client.synthesizeSpeech({
          OutputFormat: config.outputFormat, TextType: "ssml", VoiceId: config.voiceId, Engine: config.engine,
          Text: `<speak><phoneme alphabet="ipa" ph="${utils.escapeXml(ipa)}">${utils.escapeXml(word)}</phoneme></speak>`
        }).promise();
        if (disposed || current !== version) return false;
        const blob = utils.toAudioBlob(data.AudioStream, config.outputFormat);
        if (!blob) throw new Error("Pronunciation audio could not be read.");
        source = url.createObjectURL(blob); cache.set(key, source);
      }
      if (current !== version || disposed) return false;
      audio.src = source;
      await audio.play();
      return current === version && !disposed;
    }
    function dispose() {
      stop(); disposed = true;
      for (const source of cache.values()) url.revokeObjectURL(source);
      cache.clear();
    }
    return { play, stop, dispose };
  }
  const api = { create };
  root.SECRET_FLASHCARD_AUDIO = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
