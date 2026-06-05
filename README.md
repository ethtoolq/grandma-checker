# Can My Grandma Use It?

A tool that rates any website by how easy it is for non-technical users.  
No AI — pure DOM parsing, UX heuristics and a rule-based scoring engine.

Open source · MIT License

## How it works

Parses the page and scores it based on:
- Number of buttons, inputs, links
- Navigation depth
- Technical jargon
- Text density and CTA presence

Grandma Score: 42/100
"To find the register button takes 4 clicks. Don't even try."

## Stack

Node.js · Express · Cheerio · Vanilla JS · EN/RU

## Run locally

```bash
npm install
npm run dev
# http://localhost:3000
```
