# Debby

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

## Environment Variables

Create a `.env` file in the project root for local development.

```env
OPENAI_API_KEY=your_openai_api_key
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
MONGO_URI=your_mongodb_connection_string
SECRET_KEY=your_flask_secret_key
APP_PASSWORD=optional_site_password
```

Required:

- `OPENAI_API_KEY`
- `ASSEMBLYAI_API_KEY`

Optional:

- `MONGO_URI`: Defaults to `mongodb://localhost:27017/` if not provided.
- `SECRET_KEY`: Used for Flask sessions. If omitted, a random key is generated on startup.
- `APP_PASSWORD`: Enables password protection for the app when set.

## Local Setup

1. Clone the repository.

```bash
git clone https://github.com/RutanshP/Debby.git
cd Debby
```

2. Create and activate a virtual environment.

```bash
python -m venv .venv
.venv\Scripts\activate
```

3. Install dependencies.

```bash
pip install -r requirements.txt
```

4. Add your `.env` file with the required API keys.

5. Run the app locally.

```bash
python main.py
```

6. Open the app.

```text
http://127.0.0.1:8000
```

## Deployment

Debby is configured for Railway.

- `Procfile`:

```text
web: gunicorn main:app --bind 0.0.0.0:$PORT
```

- `railway.toml` uses the same Gunicorn start command.

Set the required environment variables in Railway before deploying:

- `OPENAI_API_KEY`
- `ASSEMBLYAI_API_KEY`
- `MONGO_URI`
- `SECRET_KEY`
- `APP_PASSWORD` if password protection is desired

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
