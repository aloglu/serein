import process from "node:process";

const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();

if (!apiKey) {
  throw new Error("Missing ELEVENLABS_API_KEY.");
}

async function fetchVoicesPage(nextPageToken = "") {
  const url = new URL("https://api.elevenlabs.io/v1/voices");
  url.searchParams.set("page_size", "100");
  url.searchParams.set("include_total_count", "true");
  if (nextPageToken) {
    url.searchParams.set("next_page_token", nextPageToken);
  }

  const response = await fetch(url, {
    headers: {
      "xi-api-key": apiKey
    }
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Could not list ElevenLabs voices (${response.status} ${response.statusText}). ${details}`.trim());
  }

  return response.json();
}

async function main() {
  let nextPageToken = "";
  const voices = [];

  do {
    const payload = await fetchVoicesPage(nextPageToken);
    voices.push(...(payload.voices || []));
    nextPageToken = payload.has_more ? String(payload.next_page_token || "").trim() : "";
  } while (nextPageToken);

  const rows = voices
    .map((voice) => ({
      name: String(voice.name || "").trim(),
      voiceId: String(voice.voice_id || "").trim(),
      category: String(voice.category || "").trim(),
      description: String(voice.description || "").trim()
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const row of rows) {
    const suffix = row.description ? ` - ${row.description}` : "";
    console.log(`${row.name} | ${row.voiceId} | ${row.category}${suffix}`);
  }

  console.log("");
  console.log(`Listed ${rows.length} voice(s).`);
}

await main();
