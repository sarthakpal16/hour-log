# Hour Log

Log hours and see them on a GitHub-style calendar. A plain HTML/JS web app with no build step:
add it to your iPhone's Home Screen and it behaves like an app. Sync runs through Supabase.

## Run locally

```bash
python3 -m http.server 4317
```

Then open http://localhost:4317.

## Files

| File | What it does |
|---|---|
| `index.html`, `styles.css` | Page and styling |
| `app.js` | Calendar, stats, logging, sign-in UI |
| `store.js` | Local storage, offline outbox, Supabase sync |
| `config.js` | Your Supabase URL and anon key (empty = local-only) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Home Screen install |
| `supabase/schema.sql` | Database table and row-level security |

## Supabase setup (one time)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: paste `supabase/schema.sql`, then click **Run**.
3. **Authentication → Emails → Templates**: in both **Magic Link** and **Confirm signup**, add
   `<p>Your code: {{ .Token }}</p>`. The app signs in with a typed code rather than a link,
   because on iPhone a link would open in Safari instead of the Home Screen app.
4. **Project Settings → API**: copy the Project URL and the anon/publishable key into `config.js`.
5. Sign in once in the app, then go to **Authentication → Sign In / Providers** and turn off
   **Allow new users to sign up**, so nobody else can make an account on your project.

Free Supabase projects pause after about a week with no activity. If that happens, the app keeps working
and queues your changes. Restore the project from the dashboard and they'll upload.

## Install on iPhone

Open the GitHub Pages URL in Safari, then choose **Share → Add to Home Screen**.
