# Desk Bud

A cute blue helper that uses your computer for you. Say "Hey Desk Bud, open YouTube" to your phone, and its own little blue mouse does the work on your Windows or Mac computer.

## How it fits together

| Part | Folder | Runs on | What it does |
|---|---|---|---|
| Website and relay | `server/` | Render | Pairs your phone and computer, passes messages between them, and is the phone's Desk Bud |
| Desktop app | `desktop/` | Your computer | Draws the blue mouse, clicks, types, and talks to Claude |

A website isn't allowed to move your mouse, so the computer needs the small desktop app. The website handles everything else.

## Do I need an API?

**For simple requests, no.** These are free and instant: open a website or app, search, type, press keys, scroll.

**For complex work, yes.** Anything that needs to look at the screen and think, like "find the cheapest flight" or "fix the bug in my project", needs a key from **Claude** or **Gemini**:

1. Create a key at [platform.claude.com](https://platform.claude.com/settings/keys) or [Google AI Studio](https://aistudio.google.com/apikey).
2. Paste it into the Desk Bud app on your computer, and pick that brain.

You pay the provider for what you use. Each step of a task sends a screenshot, so long jobs cost more. Set a spending limit in your account. Check each provider's terms for how they handle screenshots, especially on a free plan.

Keys stay encrypted on your computer. Never put one on GitHub or Render. Voice recognition uses the free one built into your phone's browser, so it needs no key.

## Set it up

### 1. Put the code on GitHub

Create a repository and upload everything in this folder. Keep `Dockerfile` at the top level.

### 2. Host the website on Render

1. In Render, choose **New**, then **Blueprint**, and pick your repository. It reads `render.yaml` and `Dockerfile` for you.
2. When asked for `GITHUB_REPO`, type your repository as `yourname/desk-bud`.
3. Wait for the deploy, then open your site. It will look like `https://desk-bud-xxxx.onrender.com`.

If you make a plain **Web Service** instead of a Blueprint, choose Docker and add an environment variable called `SERVER_SECRET` set to any long random text. Without it, you'll have to pair again every time the server restarts.

### 3. Build the installers

On GitHub, open **Actions**, choose **Build desktop app**, and press **Run workflow**. In about 15 minutes the installers appear under **Releases**, and your website's download buttons start working.

### 4. Pair your phone

1. Open your website on your phone. It shows a code.
2. Open the same website on your computer. It recognises Windows or Mac and offers the download.
3. Install Desk Bud, then type the code on the website.
4. Your browser asks to open Desk Bud. Say yes, then press **Connect** in the app.

**Windows** may show "Windows protected your PC", because the app isn't signed. Press **More info**, then **Run anyway**.

If **Smart App Control** is on, Windows may block the installer with no way to run it anyway. Check under **Windows Security**, then **App & browser control**. The proper fix is to code sign the installer, for example with Azure Artifact Signing. You can also turn Smart App Control off, but that's a security trade-off, and on most PCs you can't turn it back on without resetting Windows. Building the installer on such a PC can fail too, which is one reason GitHub builds it instead.

**Mac** will block it the first time. Go to **System Settings**, then **Privacy & Security**, and press **Open Anyway**. Then allow Desk Bud under **Accessibility** and **Screen Recording** there.

### 5. Talk to it

Tap **Start listening** on your phone and stand it up facing you. Then say "Hey Desk Bud". The camera is never used.

## Things worth knowing

**The blue mouse.** Windows and Mac only have one real pointer. The blue mouse glides on a see-through layer, and when it clicks, your real pointer hops to the spot and back in a few milliseconds. You won't lose your place, but don't drag or type at the exact moment it's working. Keyboard input goes to whichever window is in front. Hovering is the one action that leaves your pointer where Desk Bud put it.

**Your phone has to stay on.** A website can't listen in your pocket or with the screen off. Keep the page open. Desk Bud asks the phone to keep its screen on, so plugging it in helps.

**Listening works best in Chrome on Android.** iPhone Safari's continuous listening is less reliable. If it stops, tap to restart it, or type your request instead. Your browser's speech service, usually Google or Apple, processes what the mic hears while listening is on, including before you say the wake phrase.

**Render's free plan falls asleep** after about 15 minutes without visits, and the first visit afterwards can take a minute. Desk Bud reconnects by itself. For instant response, use a paid plan.

**Only your main screen** is used if you have more than one monitor.

## Staying safe

This app can control your computer, so please treat it that way.

- **Stop it any time.** Press `Ctrl` `Alt` `Esc` on the computer, say "Hey Desk Bud, stop", tap **Stop** on the phone, or use **Pause** in the app.
- **Pairing codes** work once, last 5 minutes, and are rate limited. The app also asks you before it connects to any server, because any website can try to open a Desk Bud link.
- **Asking first.** Claude has to ask on your phone before buying, sending, deleting, changing security settings, or typing passwords. That's an instruction it follows, not a hard lock, so watch important jobs.
- **Terminal commands** are off by default. Turn them on for coding work, and you approve each command on your phone.
- **Web pages can try to trick AI.** Claude is told to ignore instructions it sees on screen, but no defence is perfect. Avoid leaving it alone with your banking or email. A separate user account or spare computer is safest for big jobs.
- **Your server is trusted.** Commands and any remote screen view pass through it over encrypted connections, and it stores none of them. Anyone who controls your Render account or `SERVER_SECRET` could control paired computers, so protect both. Screenshots for Claude go straight from your computer to Anthropic.

## For developers

```bash
cd server
npm install
npm test
npm start
```

```bash
cd desktop
npm install
node node_modules/electron/install.js
npm test
npm start
```

Newer versions of npm skip Electron's download step, which is why `install.js` is run by hand. Open `http://localhost:3000/?as=phone` to see the phone view on a computer.

Complex requests use Claude Opus 5.5 with the computer use toolset and server-side refusal fallbacks. You can pick Sonnet 5.5 in the app to spend less.
