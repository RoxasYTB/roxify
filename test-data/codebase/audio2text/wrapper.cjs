/**
 * Wrapper for audio2text module to handle parameter naming
 */

/**
 * Process a Discord voice message and return transcription
 * @param {string} url - URL to the voice message
 * @returns {Promise<Object>} Object containing transcription data
 */
async function processVoiceMessage(url) {
  try {
    // Import the ES module
    const audioModule = await import('./index.js');

    // Call the function directly with the URL parameter instead of using global
    const result = await audioModule.processDiscordVoiceMessage(url);

    return result;
  } catch (error) {
    console.error('Error processing voice message:', error);
    return {
      success: false,
      message: error.message,
      transcription: 'Erreur lors de la transcription',
    };
  }
}

module.exports = { processVoiceMessage };
