(async () => {
  const files = [
    '../commands/ai/aiMessage.js',
    '../commands/ai/aiSay.js',
    '../commands/ai/aiDelete.js',
    '../commands/ai/aiEdit.js',
    '../commands/ai/aiResponse.js',
    '../commands/ai/createquote.js',
    '../commands/ai/transcript.js',
  ];

  for (const f of files) {
    try {
      console.log('Importing', f);
      await import(f);
      console.log(`OK: ${f}`);
    } catch (err) {
      console.error(`ERR: ${f}`);
      console.error(err);

      process.exit(1);
    }
  }

  console.log('All command modules imported successfully.');
})();

