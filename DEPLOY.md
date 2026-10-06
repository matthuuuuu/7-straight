# Putting 7 Straight online (GitHub + Vercel)

About 10 minutes, all free, no credit card. You do steps 1–3 once. After that,
every change you push to GitHub goes live by itself.

## 1. Put the code on GitHub

1. Sign in at <https://github.com> and click **New repository**.
2. Name it (for example `7-straight`), leave everything else as is, click **Create repository**.
3. Ask Claude: *"push this project to my new GitHub repo `<your-username>/7-straight`"*.
   (Or, in a terminal inside this folder:)

   ```bash
   git init
   git add .
   git commit -m "7 Straight"
   git branch -M main
   git remote add origin https://github.com/<your-username>/7-straight.git
   git push -u origin main
   ```

## 2. Deploy it on Vercel

1. Sign in at <https://vercel.com> with your GitHub account.
2. **Add New… → Project**, pick the `7-straight` repository, click **Import**.
3. Vercel detects **Vite** on its own. Don't change any settings. Click **Deploy**.
4. When it finishes, open the project's **Overview** page. The address listed
   under **Domains** (like `7-straight-yourname.vercel.app`) is your game.
   *Play on this device* already works there.

## 3. Switch on online rooms (the free database)

Online rooms need somewhere to keep each game while people play. Vercel hooks
this up for you:

1. Open your project on Vercel → **Storage** tab → **Create Database**.
2. Choose **Upstash** → **Upstash for Redis** → **Continue**.
3. Pick the **Free** plan and the **US East (Washington, D.C.)** region. That's
   where Vercel runs the game's server, so moves stay snappy. Then **Create**.
4. On the next screen, connect it to your `7-straight` project. Keep all
   environments ticked, and **leave "Custom Prefix" empty** (anything typed
   there hides the database from the game). Confirm. This adds settings such
   as `KV_REST_API_URL` and `KV_REST_API_TOKEN` to your project.
5. Go to **Deployments**, open the **⋯** menu on the newest one, and choose
   **Redeploy**, so the site picks up the new settings.

Done. Open the game on your phone, tap **Create online room**, and have friends
scan the QR code.

> **Share the Domains address from step 2.4.** The long addresses in the
> Deployments list ask visitors to log in to Vercel, and the invite QR code
> copies whatever address you opened the game from.

> If you skip step 3, the site still loads, but *Create online room* shows a
> message saying online rooms aren't switched on yet.

## Free-tier limits (plenty for a class)

- During a round each phone checks for news about once a second. That's about
  **10–15k database requests for a 30-minute, 8-player game**. Upstash's free
  tier includes 500k a month, so roughly 30–40 full games a month.
- Screens that are just sitting there (a lobby, the results, a tab in the
  background) slow down to one check every 5–45 seconds, so a forgotten open
  laptop costs very little. Rooms nobody is looking at delete themselves
  (lobbies after 1 hour, games after 8 hours).
- Vercel's free Hobby plan is for personal, non-commercial projects, which fits
  a school project.

## If online rooms stop working

If *Create online room* says **"The online-rooms database isn't answering"**:

- **Used up the month's free requests?** Open Vercel → **Storage** → your
  database → **Open in Upstash** and look at the usage. The allowance resets
  each month (or you can add a card to Upstash for pay-as-you-go).
- **Paused after about a month with no games?** Upstash pauses idle free
  databases. In the Upstash console, restore it (or create a new free database
  and connect it as in step 3), then **Redeploy**.
- **Anything else:** ask Claude, and paste the message you see.

*Play on this device* keeps working the whole time.

## Updating the live site

Make your change (ask Claude), check it locally, then push:

```bash
git add .
git commit -m "Describe the change"
git push
```

Vercel rebuilds and publishes it in about a minute. Phones that installed the
game pick up the new version the next time they open it.
