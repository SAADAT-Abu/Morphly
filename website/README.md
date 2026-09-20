# Morphly website

A single static page: `index.html` plus the images in `assets/`. There is no
build step, so any static host can serve this folder as it is.

## Publish on Cloudflare Pages

The live site is served by Cloudflare Pages at `https://morphly.pages.dev`.

1. In the Cloudflare dashboard, open Workers and Pages, then create a Pages
   project connected to the GitHub repository `SAADAT-Abu/Morphly`.
2. Project name: `morphly`. Production branch: `main`. Framework preset:
   None. Build command: leave empty. Build output directory: `website`.
3. Every push to `main` then publishes the site again. Pushes to other
   branches get their own preview addresses.

Cloudflare reads `_headers` for caching. `.nojekyll` only matters if the
folder is ever served from GitHub Pages instead.

If the project name is not `morphly`, change the two `og:` addresses at the
top of `index.html`, which link previews use.

## Visit and download counts

The page uses [GoatCounter](https://www.goatcounter.com), which is free for
non-commercial projects, sets no cookies and stores no personal data, so no
cookie banner is needed.

1. Sign up at goatcounter.com and choose a code. This site uses `abusaadat`, which
   gives `abusaadat.goatcounter.com`.
2. In `index.html`, find `const ANALYTICS` and set
   `goatcounter: "abusaadat"` (already done).
3. Publish. The GoatCounter dashboard then shows:
   - visits and unique visitors per day,
   - the countries visitors come from, and the sites that linked to the page,
   - browsers, systems and screen sizes,
   - one event per installer clicked, listed as `download/Morphly Setup 0.4.0.exe`
     and so on.

## Email updates

Addresses go straight to [MailerLite](https://www.mailerlite.com), which holds
the list, sends the confirmation email and handles unsubscribing. This site
never stores or sees them, so there is no database to secure.

1. Create a MailerLite account and a group, for example "Morphly updates".
2. Build an embedded form there and turn double opt-in on, so every subscriber
   confirms by email. That is the record of consent.
3. Copy the form's action address out of the embed code. It looks like
   `https://assets.mailerlite.com/jsonp/123456/forms/7890123/subscribe`.
4. In `index.html`, find `const NEWSLETTER` and put that address in `action`.
   This site uses form 199139914384672337 in account 2648022.

That switches on both the signup box under the download cards and the small
ask that appears after a download starts. The ask has a Skip button, closes
with Escape, and does not come back for anyone who skipped or subscribed.
An empty `action` keeps both hidden, which is how the site ships.

Removal requests are handled in the MailerLite dashboard, and every email
carries an unsubscribe link.

The download counts are clicks on this page. Zenodo counts every download of
the files separately, including links shared elsewhere, on the record page.

## A new release

At the top of the script in `index.html`, change `RELEASE.version` and
`RELEASE.record` to the new Zenodo record. The download links and the Linux
command follow. Also update the file sizes on the download cards, the version
in the citation, and the roadmap.
