# Morphly website

A single static page: `index.html` plus the images in `assets/`. There is no
build step, so any static host can serve this folder as it is.

## Publish on GitHub Pages

1. In the repository on GitHub, open Settings, then Pages.
2. Under Source, choose GitHub Actions.
3. Push a change to `website/` on `main`, or run the "Website" workflow by
   hand from the Actions tab.

The workflow in `.github/workflows/pages.yml` uploads this folder. The site
appears at `https://saadat-abu.github.io/Morphly/`.

## Publish on Cloudflare Pages

1. In the Cloudflare dashboard, open Workers and Pages, then create a Pages
   project connected to the GitHub repository.
2. Production branch: `main`. Build command: leave empty. Build output
   directory: `website`.

Cloudflare reads `_headers` for caching. GitHub Pages ignores that file, and
`.nojekyll` stops GitHub from running the page through Jekyll.

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

The download counts are clicks on this page. Zenodo counts every download of
the files separately, including links shared elsewhere, on the record page.

## A new release

At the top of the script in `index.html`, change `RELEASE.version` and
`RELEASE.record` to the new Zenodo record. The download links and the Linux
command follow. Also update the file sizes on the download cards, the version
in the citation, and the roadmap.
