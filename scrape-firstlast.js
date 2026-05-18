const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getCDXCaptures() {
  console.log('Querying CDX API...');
  const url = 'http://web.archive.org/cdx/search/cdx?url=rogercollier.com/firstlast*&output=json&fl=timestamp,original&collapse=urlkey';
  const res = await axios.get(url, { timeout: 30000 });
  const rows = res.data.slice(1);
  console.log(`Found ${rows.length} captures`);
  return rows.map(([timestamp, original]) => ({
    timestamp,
    original,
    archiveUrl: `https://web.archive.org/web/${timestamp}/${original}`
  }));
}

function isTitle(text) {
  // Titles look like: "BOOK NAME (AUTHOR NAME)" - mostly uppercase
  const upper = text.replace(/[^a-zA-Z]/g, '');
  if (upper.length < 5) return false;
  const ratio = (text.match(/[A-Z]/g) || []).length / upper.length;
  return ratio > 0.7 && text.includes('(') && text.includes(')');
}

async function scrapePage(archiveUrl) {
  const res = await axios.get(archiveUrl, { timeout: 30000 });
  const $ = cheerio.load(res.data);
  $('#wm-ipp-base, .wb-autocomplete-suggestions').remove();

  // Collect all meaningful paragraph texts in order
  const paragraphs = [];
  $('p').each((i, el) => {
    const text = $(el).text().trim();
    if (text.length > 10) paragraphs.push(text);
  });

  const entries = [];
  let i = 0;

  while (i < paragraphs.length) {
    const p = paragraphs[i];

    if (isTitle(p)) {
      // Next two paragraphs should be first + last sentence
      const title = p;
      const first = paragraphs[i + 1] || '';
      const last = paragraphs[i + 2] || '';
      if (first && last && !isTitle(first) && !isTitle(last)) {
        entries.push({ bookTitle: title, firstSentence: first, lastSentence: last });
        i += 3;
        continue;
      }
    }

    // No title — treat consecutive non-title paragraphs as first/last pairs
    const next = paragraphs[i + 1];
    if (next && !isTitle(p) && !isTitle(next)) {
      entries.push({ bookTitle: null, firstSentence: p, lastSentence: next });
      i += 2;
      continue;
    }

    i++;
  }

  return entries;
}

async function main() {
  const captures = await getCDXCaptures();

  const byUrl = {};
  for (const cap of captures) {
    byUrl[cap.original] = cap;
  }
  const unique = Object.values(byUrl).filter(c => !c.original.includes('/feed'));
  console.log(`Unique URLs to fetch: ${unique.length}`);
  unique.forEach(u => console.log(' ', u.archiveUrl));

  const allEntries = [];
  const seen = new Set();

  for (const cap of unique) {
    console.log(`\nFetching ${cap.archiveUrl}`);
    try {
      const entries = await scrapePage(cap.archiveUrl);
      console.log(`  Found ${entries.length} entries`);
      for (const entry of entries) {
        const key = entry.firstSentence.slice(0, 80);
        if (!seen.has(key)) {
          seen.add(key);
          allEntries.push({ ...entry, sourceUrl: cap.original, captureDate: cap.timestamp });
        }
      }
      await sleep(2000);
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log(`\nTotal unique entries: ${allEntries.length}`);
  fs.writeFileSync('firstlast-data.json', JSON.stringify(allEntries, null, 2));
  console.log('Saved to firstlast-data.json');

  // Print a preview
  console.log('\n--- PREVIEW (first 10) ---');
  allEntries.slice(0, 10).forEach((e, i) => {
    console.log(`\n[${i+1}] ${e.bookTitle || '(no title)'}`);
    console.log(`  FIRST: ${e.firstSentence.slice(0, 100)}`);
    console.log(`  LAST:  ${e.lastSentence.slice(0, 100)}`);
  });
}

main().catch(console.error);
