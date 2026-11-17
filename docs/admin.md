# Admin page (feedback + numbers)

The admin page lives at **`/admin`** (e.g. `https://arcane-academies.onrender.com/admin`). Nothing in the game links to it.

It has three locks, all checked by the server on every request:

1. You are logged in to the game with your own account in that browser.
2. Your account has `is_admin = true` in the database. The app can never set this; only you, by hand.
3. A 6-digit code from an authenticator app on your phone (or a one-time backup code).

The admin session ends after 30 minutes without use. 5 wrong codes lock the page for 15 minutes.

## One-time setup

### 1. Add `ADMIN_KEY` on Render

Render → the `arcane-academies` service → **Environment** → **Add Environment Variable**:

- Key: `ADMIN_KEY`
- Value: click **Generate** (or paste any long random text, at least 16 characters).

Save. Render redeploys. This key encrypts the authenticator secret in the database; the admin page is off without it.
Do not change it later (if you do, reset the authenticator, see below).

### 2. Make your account the admin (one SQL line)

Neon console → your project → **SQL Editor**, run (put your game username in place of `YourUsername`):

```sql
update users set is_admin = true where username_key = lower('YourUsername');
```

It should say `UPDATE 1`. (The column appears after the new version has started once.)

### 3. Connect your phone

1. Install **Google Authenticator** or **Microsoft Authenticator** (free) from your phone's app store.
2. On the computer, log in to the game, then open `/admin`.
3. Tap **I have the app — show the QR code**.
4. In the phone app tap **+** → **Scan a QR code** and point the camera at the screen.
5. Type the 6-digit code the app shows for *Arcane Academies* and press **Continue**.
6. You get 8 **backup codes**. Write them down or save them somewhere safe: each one lets you in once if you lose your phone. They are shown only this time.

From then on, `/admin` asks for the current 6-digit code from the app.

## If you lose your phone

- Use one of the backup codes in the code box.
- No backup codes left? Reset the authenticator in Neon's SQL Editor, then do step 3 again:

```sql
delete from admin_factors where user_id = (select id from users where username_key = lower('YourUsername'));
```

## Remove admin rights

```sql
update users set is_admin = false where username_key = lower('YourUsername');
```

## What is counted

Our own server and database only (no third-party analytics): app opens per device (random id made on the device),
sign-ups, logged-in players per day, games started / reached Term 2 / finished per mode, and whether new devices come
back the next day or week. AI opponents and bots never count. No IP addresses are stored.
