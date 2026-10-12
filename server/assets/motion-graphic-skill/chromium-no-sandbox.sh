#!/bin/sh
# record.js launches CHROME without extra flags; the processor container runs as a non-root user with no user
# namespaces, where Chromium's sandbox can't start. Only local template HTML is ever loaded.
exec /usr/bin/chromium --no-sandbox --disable-dev-shm-usage "$@"
