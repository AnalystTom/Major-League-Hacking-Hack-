// How long a worker's claim on a job lasts before another worker may take the job over. Shared by the ingest
// store (a unit being extracted) and the outputs store (a skill or short being made).
// It must outlast the slowest legitimate job. One extraction is up to 4 attempts of (90 s + window / 10) plus
// backoff, about 31 minutes at the 3,600 s maximum window. A render (script, narrated scenes with retries,
// ffmpeg, three uploads) stays well inside an hour. So an hour never takes over work that's still running.
export const STALE_CLAIM_MINUTES = 60;
