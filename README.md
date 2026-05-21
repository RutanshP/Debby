# Debby

> **Refactor in progress.** Debby is being rewritten from Flask + vanilla JS to **FastAPI (`apps/api/`)** and **Next.js (`apps/web/`)** with Supabase auth/DB. The legacy Flask app under `backend/`, `static/`, `templates/`, and `main.py` continues to run until cutover. See `apps/api/` and `apps/web/` for the new code and `apps/api/migrations/0001_init.sql` for the new schema.

Debby is a web application for independent debate practice. It lets students generate debate topics, record speeches, receive an AI opponent response, deliver a rebuttal, and review a judge-style reason for decision with speech statistics.

The app currently supports MSPDP and Parliamentary debate practice, including tournament-based Parliamentary topic selection, speed-reading drills, case generation, round history, and delivery analytics.

## Features

- **Practice rounds**: Generate or enter a topic, record an affirmative speech, receive Debby's response, record a rebuttal, and get a winner with an RFD.
- **Speech transcription**: Uses AssemblyAI to transcribe recorded browser audio.
- **AI debate response and judging**: Uses OpenAI to generate opposing speeches, drill feedback, debate flows, and judge decisions.
- **Speech analytics**: Calculates WPM, word counts, speech duration, average WPM, and WPM over time.
- **Debate drills**: Includes rebuttal, speed reading, impact extension, and contention brainstorming drills.
- **Case Builder**: Generates formatted MSPDP or Parliamentary cases for either side of a topic.
- **Round history**: Saves past rounds, transcripts, decisions, statistics, and generated flows.
- **Deployment-ready**: Includes Gunicorn/Railway configuration.

## Tech Stack

- **Backend**: Flask, Python
- **Frontend**: HTML, CSS, vanilla JavaScript
- **AI APIs**: OpenAI, AssemblyAI
- **Audio processing**: pydub, imageio-ffmpeg
- **Data storage**: MongoDB via PyMongo, with local JSON fallback
- **Charts and stats**: matplotlib, textstat
- **Deployment**: Railway, Gunicorn

## Project Structure

```text
Debby/
|-- backend/
|   |-- app.py          # Flask routes, persistence, scoring endpoints
|   |-- debby.py        # AI generation, topic selection, transcription logic
|   |-- parligpt.py     # Case generation and text-to-speech helpers
|   `-- view_db.py      # Database utility script
|-- data/
|   |-- parlires.csv    # Parliamentary resolution data
|   |-- msres.csv       # MSPDP resolution data
|   `-- audio/          # Runtime audio files
|-- static/
|   |-- app.js          # Main practice-round frontend logic
|   |-- drills.js       # Drill frontend logic
|   |-- styles.css      # Shared application styles
|   `-- *.png/*.gif     # Logos and loading assets
|-- templates/
|   |-- index.html      # Practice round page
|   |-- drills.html     # Drill page
|   |-- parli_gpt.html  # Case Builder page
|   |-- flowbot.html    # Flow page
|   `-- view_entries.html
|-- main.py             # Local Flask entry point
|-- requirements.txt
|-- Procfile
`-- railway.toml
```

## Main Routes

| Route | Purpose |
| --- | --- |
| `/` | Main debate practice page |
| `/drills` | Debate drill workspace |
| `/parli-gpt` | Case Builder |
| `/flowbot` | Flow tool |
| `/view_entries` | Saved round history |
| `/get-topic` | Generate or submit topics |
| `/process-recording` | Submit round speech recordings |
| `/api/generate-drill` | Generate drills |
| `/api/score-drill` | Score written drills |
| `/api/score-speed-drill` | Score speed-reading recordings |

## Notes

- Browser microphone permissions must be enabled for recording features.
- Recorded audio is saved under `data/audio/` during runtime.
- If MongoDB is unavailable, the app falls back to local JSON storage in `data/debate_entries.json`.
- `imageio-ffmpeg` is used so pydub can convert browser-recorded audio for transcription.

## License

No license file is currently included.
