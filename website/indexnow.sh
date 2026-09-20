#!/usr/bin/env bash
# Tells Bing, Yandex and other IndexNow engines that a page has changed.
# The key below is public on purpose: it also sits at
# https://morphly.pages.dev/$KEY.txt, which is how the engines check that
# whoever pings them controls the site.
#
# Run it after a deploy:  ./indexnow.sh            (the home page)
#                         ./indexnow.sh /sitemap.xml  (any other path)
set -euo pipefail
KEY="8434154834a0eaa5b293528184fca63f"
HOST="morphly.pages.dev"
PATH_TO_PING="${1:-/}"
curl -sS -o /dev/null -w "IndexNow: %{http_code}\n" \
  "https://api.indexnow.org/indexnow?url=https://$HOST$PATH_TO_PING&key=$KEY&keyLocation=https://$HOST/$KEY.txt"
