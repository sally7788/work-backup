import assert from "node:assert/strict";
import { splitDiscordContent } from "./discord.js";

function stripPrefix(value) {
  return String(value).replace(/^\(\d+\/\d+\)\s/, "");
}

function run() {
  {
    const text = "hello\nworld";
    const chunks = splitDiscordContent(text, 2000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], text);
  }

  {
    const line = "x".repeat(500);
    const text = Array.from({ length: 20 }, () => line).join("\n"); // > 2000
    const chunks = splitDiscordContent(text, 2000);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.length <= 2000);

    const total = chunks.length;
    chunks.forEach((chunk, i) => {
      assert.match(chunk, new RegExp(`^\\(${i + 1}\\/${total}\\) `));
    });

    const roundTrip = chunks.map(stripPrefix).join("\n");
    assert.equal(roundTrip, text);
  }

  console.log("discord.selftest OK");
}

run();

