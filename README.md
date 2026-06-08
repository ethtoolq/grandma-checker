# can my grandma use it?

paste a url, get a score on how easy the site is for non-technical users.

## stack

node + express + cheerio on the backend, vanilla js on the frontend. scores based on dom parsing — buttons, inputs, nav depth, jargon, text density.

## setup

```bash
npm install
npm run dev
```

open http://localhost:3000

## how scoring works

checks things like:
- how many clicks to find the main action
- amount of technical jargon on the page
- text density and readability
- presence of clear cta buttons

outputs a score 0–100 and a short verdict.

## notes

- en and ru supported
- MIT license
